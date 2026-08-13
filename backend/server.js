require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai');
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

// JWT Secret Key configuration
const JWT_SECRET = process.env.JWT_SECRET || 'omnistudy_ai_poc_jwt_secret_token_123456';

const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function initDb() {
  try {
    await pool.query('SELECT NOW()');
    console.log("Connected to PostgreSQL database successfully.");

    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log("Vector extension verified/enabled.");

    // Check if column users.id is bigint to handle schema upgrade
    const typeCheck = await pool.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'id'
    `);
    if (typeCheck.rows.length > 0 && typeCheck.rows[0].data_type !== 'bigint') {
      console.log("Upgrading database schema to support 64-bit integer IDs...");
      await pool.query('DROP TABLE IF EXISTS material_chunks, materials, users CASCADE;');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS material_chunks (
        id BIGSERIAL PRIMARY KEY,
        material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding vector(3072)
      )
    `);

    console.log("Database schema tables initialized successfully.");

    // Auto-migrate users from legacy users.json file if present
    const USERS_FILE = path.join(__dirname, 'users.json');
    if (fs.existsSync(USERS_FILE)) {
      try {
        const fileData = fs.readFileSync(USERS_FILE, 'utf8');
        const usersArray = JSON.parse(fileData);
        for (const u of usersArray) {
          const check = await pool.query('SELECT * FROM users WHERE email = $1', [u.email.toLowerCase().trim()]);
          if (check.rows.length === 0) {
            await pool.query(
              'INSERT INTO users (id, name, email, password) VALUES ($1, $2, $3, $4)',
              [parseInt(u.id, 10), u.name.trim(), u.email.toLowerCase().trim(), u.password]
            );
            console.log(`Migrated user account to PostgreSQL: ${u.email}`);
          }
        }
      } catch (e) {
        console.error("Failed to migrate legacy users.json data:", e);
      }
    }
  } catch (err) {
    console.error("Database initialization failed:", err);
    process.exit(1);
  }
}

initDb();

// Enable CORS for frontend integration
app.use(cors());
app.use(express.json());

// Set up Multer for memory storage of file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize the Google Gen AI client
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === 'your_gemini_api_key_here') {
  console.warn("WARNING: GEMINI_API_KEY is not configured in .env!");
}
const ai = new GoogleGenAI({ apiKey });

/* --- Authentication Middleware --- */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. Authentication token missing.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified; // { id, name, email }
    next();
  } catch (err) {
    res.status(403).json({ error: 'Session expired or token is invalid.' });
  }
}

/* --- User Authentication Endpoints --- */

// Endpoint: Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Please enter all fields (name, email, password).' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists in PostgreSQL
    const existCheck = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (existCheck.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save user to PostgreSQL
    const userId = Date.now();
    const insertRes = await pool.query(
      'INSERT INTO users (id, name, email, password) VALUES ($1, $2, $3, $4) RETURNING id, name, email',
      [userId, name.trim(), normalizedEmail, hashedPassword]
    );
    const newUser = insertRes.rows[0];

    // Sign JWT
    const token = jwt.sign(
      { id: newUser.id.toString(), name: newUser.name, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: newUser.id.toString(),
        name: newUser.name,
        email: newUser.email
      }
    });

  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: 'Registration failed due to a server error.' });
  }
});

// Endpoint: Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter both email and password.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Query user from PostgreSQL
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }
    const user = userRes.rows[0];

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id.toString(), name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email
      }
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

// Endpoint: Fetch Current User Profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

/* --- Protected RAG Endpoints --- */

// Endpoint: Check system/document status
app.get('/api/status', authenticateToken, async (req, res) => {
  try {
    const materialRes = await pool.query(
      'SELECT id, filename, file_size FROM materials WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [req.user.id]
    );

    if (materialRes.rows.length === 0) {
      return res.json({
        hasDocument: false,
        filename: null,
        fileSize: 0,
        chunkCount: 0,
        apiKeyConfigured: !!apiKey && apiKey !== 'your_gemini_api_key_here'
      });
    }

    const material = materialRes.rows[0];
    const countRes = await pool.query(
      'SELECT COUNT(*) as count FROM material_chunks WHERE material_id = $1',
      [material.id]
    );

    res.json({
      hasDocument: true,
      filename: material.filename,
      fileSize: material.file_size,
      chunkCount: parseInt(countRes.rows[0].count, 10),
      apiKeyConfigured: !!apiKey && apiKey !== 'your_gemini_api_key_here'
    });
  } catch (err) {
    console.error("Error fetching document status:", err);
    res.status(500).json({ error: 'Failed to retrieve document status.' });
  }
});

// Endpoint: Upload PDF, parse text, chunk, and embed (Protected)
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(500).json({ error: 'Gemini API key is not configured in backend .env' });
    }

    console.log(`Processing file for user ${req.user.name}: ${req.file.originalname} (${req.file.size} bytes)`);

    // Extract text page-by-page using PDFParse
    const parser = new PDFParse({ data: req.file.buffer });
    const parsedData = await parser.getText();
    const pages = parsedData.pages.map(p => ({
      pageNumber: p.num,
      text: p.text
    }));
    console.log(`Extracted text from ${pages.length} pages.`);

    // Set up LangChain Text Splitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 600,
      chunkOverlap: 150
    });

    const plainChunks = [];

    for (const page of pages) {
      const text = page.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      const pageDocs = await splitter.createDocuments([text]);

      for (const doc of pageDocs) {
        const chunkObj = {
          text: doc.pageContent,
          page: page.pageNumber
        };
        plainChunks.push(chunkObj);
      }
    }

    console.log(`Generated ${plainChunks.length} chunks using LangChain Text Splitter.`);

    if (plainChunks.length === 0) {
      return res.status(400).json({ error: 'No text content could be extracted from this PDF.' });
    }

    // Generate embeddings via LangChain
    console.log("Generating embeddings via LangChain...");
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey,
      modelName: "models/gemini-embedding-2",
    });

    const textsToEmbed = plainChunks.map(c => c.text);
    const vectorEmbeddings = await embeddings.embedDocuments(textsToEmbed);

    console.log("Saving document metadata and chunks to PostgreSQL...");
    
    // Create transaction to save document and chunks
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Save material record
      const docRes = await client.query(
        'INSERT INTO materials (user_id, filename, file_size) VALUES ($1, $2, $3) RETURNING id',
        [req.user.id, req.file.originalname, req.file.size]
      );
      const materialId = docRes.rows[0].id;
      
      // Save chunks and vectors
      for (let i = 0; i < plainChunks.length; i++) {
        const chunk = plainChunks[i];
        const vectorStr = `[${vectorEmbeddings[i].join(',')}]`;
        
        await client.query(
          'INSERT INTO material_chunks (material_id, page_number, chunk_text, embedding) VALUES ($1, $2, $3, $4)',
          [materialId, chunk.page, chunk.text, vectorStr]
        );
      }
      
      await client.query('COMMIT');
      console.log("PostgreSQL vector indexing complete!");
      
      res.json({
        success: true,
        filename: req.file.originalname,
        chunkCount: plainChunks.length,
        message: 'PDF uploaded, chunked, and embedded successfully using LangChain and PostgreSQL.'
      });
      
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to process and embed PDF document.', details: error.message });
  }
});// Endpoint: Submit user question, perform vector retrieval, and call LLM (Protected)
app.post('/api/query', authenticateToken, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query text is required.' });
    }

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(500).json({ error: 'Gemini API key is not configured.' });
    }

    // 1. Fetch active document from PostgreSQL
    const materialRes = await pool.query(
      'SELECT id, filename FROM materials WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [req.user.id]
    );

    if (materialRes.rows.length === 0) {
      return res.status(400).json({ error: 'No document has been uploaded yet. Please upload a PDF first.' });
    }
    const material = materialRes.rows[0];

    console.log(`Query from ${req.user.name} (via LangChain & Postgres): "${query}"`);

    // 2. Generate embedding for query using LangChain wrapper
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey,
      modelName: "models/gemini-embedding-2",
    });
    const queryVector = await embeddings.embedQuery(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 3. Retrieve top 5 most similar chunks from pgvector
    const searchResults = await pool.query(`
      SELECT id, chunk_text, page_number, (1 - (embedding <=> $2)) as similarity
      FROM material_chunks
      WHERE material_id = $1
      ORDER BY embedding <=> $2
      LIMIT 5
    `, [material.id, vectorStr]);

    const relevantChunks = searchResults.rows.map(row => {
      return {
        id: row.id.toString(),
        text: row.chunk_text,
        page: row.page_number,
        similarity: parseFloat(row.similarity)
      };
    }).filter(c => c.similarity > 0.1);

    // 4. Construct context representation
    let contextText = "";
    if (relevantChunks.length > 0) {
      contextText = relevantChunks.map((chunk, index) => {
        return `[Source Chunk #${index + 1} | Page ${chunk.page} | Score: ${(chunk.similarity * 100).toFixed(1)}%]\n${chunk.text}\n`;
      }).join('\n');
    } else {
      contextText = "No relevant context found.";
    }

    // 5. Construct prompt
    const chatPrompt = `You are OmniStudy AI, an intelligent, helpful university learning assistant.
Your goal is to answer the user's question accurately using ONLY the provided lecture document context.

Review this context extracted from the lecture slides or notes:
---------------------------------------------
${contextText}
---------------------------------------------

Using the context above, write a clear, concise, and academically structured answer to the user's question.

Rules:
1. Base your answer STRICTLY on the facts and information in the provided context.
2. If the context does not contain enough information to answer the question, state: "I cannot find the answer in the uploaded lecture materials."
3. Do not invent details or pull facts from general external training data.
4. When writing your response, you do NOT need to include file citations (like "[Source Chunk #1]") directly in your text paragraphs unless you want to call out a specific page, but remember that the user interface will display the source chunks alongside your answer.

User Question: ${query}

Write the answer below:`;

    // 6. Query Gemini Chat Model wrapper in LangChain
    console.log("Requesting answer from ChatGoogleGenerativeAI (LangChain)...");
    const chatModel = new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      model: "gemini-3.5-flash",
      temperature: 0.2
    });

    const chatResponse = await chatModel.invoke(chatPrompt);
    const answer = chatResponse.content || "No response received.";

    res.json({
      answer: answer.trim(),
      sources: relevantChunks.map(chunk => ({
        id: chunk.id,
        text: chunk.text,
        page: chunk.page,
        score: chunk.similarity
      }))
    });

  } catch (error) {
    console.error('Query Error:', error);
    res.status(500).json({ error: 'Failed to process query and generate answer.', details: error.message });
  }
});

// Endpoint: Generate an interactive multiple-choice quiz based on the indexed document text (Protected)
app.post('/api/quiz', authenticateToken, async (req, res) => {
  try {
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(500).json({ error: 'Gemini API key is not configured.' });
    }

    // 1. Fetch active document from PostgreSQL
    const materialRes = await pool.query(
      'SELECT id, filename FROM materials WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [req.user.id]
    );

    if (materialRes.rows.length === 0) {
      return res.status(400).json({ error: 'No document uploaded. Please upload a PDF first.' });
    }
    const material = materialRes.rows[0];

    // 2. Fetch up to 3 chunks to provide context for the quiz
    const chunksRes = await pool.query(
      'SELECT chunk_text FROM material_chunks WHERE material_id = $1 LIMIT 3',
      [material.id]
    );

    if (chunksRes.rows.length === 0) {
      return res.status(400).json({ error: 'No chunks found for this document. Please re-upload.' });
    }

    const contextText = chunksRes.rows.map(row => row.chunk_text).join('\n\n');

    const prompt = `You are an academic instructor. Generate a multiple-choice quiz of exactly 3 questions based on the following text content.
Each question must have:
1. "question": The question text.
2. "options": An array of exactly 4 strings (multiple choice options).
3. "answerIndex": An integer (0 to 3) representing the index of the correct answer in the options array.

Respond ONLY with a valid raw JSON array of objects, with no markdown code block formatting, no backticks, no comments, and no extra text.

Text Content:
${contextText}`;

    console.log("Requesting quiz from ChatGoogleGenerativeAI (LangChain)...");
    const chatModel = new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      model: "gemini-3.5-flash",
      temperature: 0.3
    });

    const response = await chatModel.invoke(prompt);
    const responseText = response.content ? response.content.trim() : '';
    
    // Clean up any markdown code blocks just in case
    let cleanJson = responseText;
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.substring(7);
    }
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.substring(3);
    }
    if (cleanJson.endsWith('```')) {
      cleanJson = cleanJson.substring(0, cleanJson.length - 3);
    }
    cleanJson = cleanJson.trim();

    try {
      const quizQuestions = JSON.parse(cleanJson);
      res.json({ questions: quizQuestions });
    } catch (e) {
      console.error("Failed to parse LLM response as JSON:", responseText);
      // Fallback questions if JSON parsing fails
      res.json({
        questions: [
          {
            question: `What is the primary topic of the document "${material.filename}"?`,
            options: ["Supervised learning models", "Unsupervised classification", "General lecture concepts", "Database index files"],
            answerIndex: 2
          },
          {
            question: "How are concepts represented in a vector space?",
            options: ["Using word hashes", "Using multi-dimensional embeddings", "Using raw character indices", "Using simple binary flags"],
            answerIndex: 1
          },
          {
            question: "What does RAG stand for in AI document assistants?",
            options: ["Realigned Generating Agent", "Randomized Aggregated Graph", "Retrieval-Augmented Generation", "Rescaled Associative Grid"],
            answerIndex: 2
          }
        ]
      });
    }

  } catch (err) {
    console.error('Quiz Generation Error:', err);
    res.status(500).json({ error: 'Failed to generate quiz.' });
  }
});

// Endpoint: Clear the current document cache (Protected)
app.post('/api/clear', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM materials WHERE user_id = $1', [req.user.id]);
    console.log(`Document memory cleared in database for user: ${req.user.name}`);
    res.json({ success: true, message: "Cleared document database records." });
  } catch (err) {
    console.error("Error clearing document records:", err);
    res.status(500).json({ error: 'Failed to clear document records.' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`OmniStudy AI Backend running on http://localhost:${port}`);
});
