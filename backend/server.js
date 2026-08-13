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
const USERS_FILE = path.join(__dirname, 'users.json');

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

// In-memory store for RAG document state, isolated per user ID
// Structure: { [userId]: { filename, fileSize, chunks: [] } }
const userDocuments = {};

/* --- User Database Helpers --- */
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading users database:", err);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Error writing users database:", err);
  }
}

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

/* --- Helper to split page-by-page text into overlapping chunks --- */
function chunkText(pages, chunkSize = 600, overlap = 150) {
  const chunks = [];
  let chunkId = 0;

  for (const page of pages) {
    const text = page.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    if (text.length <= chunkSize) {
      chunks.push({
        id: chunkId++,
        text: text,
        page: page.pageNumber
      });
      continue;
    }

    let start = 0;
    while (start < text.length) {
      let end = start + chunkSize;
      
      if (end < text.length) {
        const nextSpace = text.indexOf(' ', end);
        if (nextSpace !== -1 && nextSpace - end < 20) {
          end = nextSpace;
        }
      } else {
        end = text.length;
      }

      const sliceText = text.substring(start, end).trim();
      if (sliceText) {
        chunks.push({
          id: chunkId++,
          text: sliceText,
          page: page.pageNumber
        });
      }

      start = end - overlap;
      if (start >= text.length - overlap) {
        break;
      }
    }
  }

  return chunks;
}

/* --- Calculates Cosine Similarity between two numeric vectors --- */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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

    const users = loadUsers();
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    if (users.find(u => u.email === normalizedEmail)) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now().toString(),
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);

    // Sign JWT
    const token = jwt.sign(
      { id: newUser.id, name: newUser.name, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
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

    const users = loadUsers();
    const normalizedEmail = email.toLowerCase().trim();
    const user = users.find(u => u.email === normalizedEmail);

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
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
app.get('/api/status', authenticateToken, (req, res) => {
  const userDoc = userDocuments[req.user.id] || { filename: null, fileSize: 0, chunks: [] };
  res.json({
    hasDocument: !!userDoc.filename,
    filename: userDoc.filename,
    fileSize: userDoc.fileSize,
    chunkCount: userDoc.chunks.length,
    apiKeyConfigured: !!apiKey && apiKey !== 'your_gemini_api_key_here'
  });
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

    const langDocs = [];
    const plainChunks = [];
    let chunkId = 0;

    for (const page of pages) {
      const text = page.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      const pageDocs = await splitter.createDocuments([text]);

      for (const doc of pageDocs) {
        const chunkObj = {
          id: `${req.user.id}_chunk_${chunkId++}`,
          text: doc.pageContent,
          page: page.pageNumber
        };
        
        langDocs.push({
          pageContent: chunkObj.text,
          metadata: {
            id: chunkObj.id,
            page: chunkObj.page
          }
        });
        plainChunks.push(chunkObj);
      }
    }

    console.log(`Generated ${plainChunks.length} chunks using LangChain Text Splitter.`);

    if (plainChunks.length === 0) {
      return res.status(400).json({ error: 'No text content could be extracted from this PDF.' });
    }

    // Generate embeddings and build Memory Vector Store using LangChain wrappers
    console.log("Generating embeddings and building memory vector store via LangChain...");
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey,
      modelName: "text-embedding-004",
    });

    const vectorStore = await MemoryVectorStore.fromDocuments(langDocs, embeddings);

    // Save to user-specific document store
    userDocuments[req.user.id] = {
      filename: req.file.originalname,
      fileSize: req.file.size,
      chunks: plainChunks,
      vectorStore: vectorStore
    };

    console.log("LangChain vector indexing complete!");
    res.json({
      success: true,
      filename: req.file.originalname,
      chunkCount: plainChunks.length,
      message: 'PDF uploaded, chunked, and embedded successfully using LangChain.'
    });

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

    const userDoc = userDocuments[req.user.id];
    if (!userDoc || !userDoc.filename || !userDoc.vectorStore) {
      return res.status(400).json({ error: 'No document has been uploaded yet. Please upload a PDF first.' });
    }
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(500).json({ error: 'Gemini API key is not configured.' });
    }

    console.log(`Query from ${req.user.name} (via LangChain): "${query}"`);

    // 1. Retrieve relevant chunks using LangChain similarity search with score
    const searchResults = await userDoc.vectorStore.similaritySearchWithScore(query, 5);

    // Map distances to scores (MemoryVectorStore uses cosine distance or L2 distance)
    const relevantChunks = searchResults.map(([doc, distance]) => {
      const similarity = Math.max(0, Math.min(1, 1 - distance));
      return {
        id: doc.metadata.id,
        text: doc.pageContent,
        page: doc.metadata.page,
        similarity: similarity
      };
    }).filter(c => c.similarity > 0.1);

    // 2. Construct context representation
    let contextText = "";
    if (relevantChunks.length > 0) {
      contextText = relevantChunks.map((chunk, index) => {
        return `[Source Chunk #${index + 1} | Page ${chunk.page} | Score: ${(chunk.similarity * 100).toFixed(1)}%]\n${chunk.text}\n`;
      }).join('\n');
    } else {
      contextText = "No relevant context found.";
    }

    // 3. Construct prompt
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

    // 4. Query Gemini Chat Model wrapper in LangChain
    console.log("Requesting answer from ChatGoogleGenerativeAI (LangChain)...");
    const chatModel = new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      modelName: "gemini-1.5-flash",
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
});// Endpoint: Generate an interactive multiple-choice quiz based on the indexed document text (Protected)
app.post('/api/quiz', authenticateToken, async (req, res) => {
  try {
    const userDoc = userDocuments[req.user.id];
    if (!userDoc || !userDoc.filename || userDoc.chunks.length === 0) {
      return res.status(400).json({ error: 'No document uploaded. Please upload a PDF first.' });
    }
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(500).json({ error: 'Gemini API key is not configured.' });
    }

    // Use up to 3 chunks to provide context for the quiz
    const contextText = userDoc.chunks.slice(0, 3).map(c => c.text).join('\n\n');

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
      modelName: "gemini-2.5-flash",
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
            question: `What is the primary topic of the document "${userDoc.filename}"?`,
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
});// Endpoint: Clear the current document cache (Protected)
app.post('/api/clear', authenticateToken, (req, res) => {
  delete userDocuments[req.user.id];
  console.log(`Document memory cleared for user: ${req.user.name}`);
  res.json({ success: true, message: "Cleared document memory." });
});

// Start the server
app.listen(port, () => {
  console.log(`OmniStudy AI Backend running on http://localhost:${port}`);
});
