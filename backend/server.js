require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai');
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

    // Perform chunking
    const rawChunks = chunkText(pages, 600, 150);
    console.log(`Generated ${rawChunks.length} chunks.`);

    if (rawChunks.length === 0) {
      return res.status(400).json({ error: 'No text content could be extracted from this PDF.' });
    }

    // Generate embeddings using gemini-embedding-2
    console.log("Generating embeddings for chunks...");
    const embeddedChunks = [];
    
    const batchSize = 5;
    for (let i = 0; i < rawChunks.length; i += batchSize) {
      const batch = rawChunks.slice(i, i + batchSize);
      const embedPromises = batch.map(async (chunk) => {
        try {
          const response = await ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: chunk.text
          });
          
          let vector = null;
          if (response.embeddings && response.embeddings[0]) {
            vector = response.embeddings[0].values;
          } else if (response.embedding && response.embedding.values) {
            vector = response.embedding.values;
          }

          if (!vector) {
            throw new Error(`Invalid response structure: ${JSON.stringify(response)}`);
          }

          return {
            ...chunk,
            embedding: vector
          };
        } catch (err) {
          console.error(`Error embedding chunk ${chunk.id}:`, err.message);
          throw err;
        }
      });

      const results = await Promise.all(embedPromises);
      embeddedChunks.push(...results);
    }

    // Save to user-specific document store
    userDocuments[req.user.id] = {
      filename: req.file.originalname,
      fileSize: req.file.size,
      chunks: embeddedChunks
    };

    console.log("Embedding complete!");
    res.json({
      success: true,
      filename: req.file.originalname,
      chunkCount: embeddedChunks.length,
      message: 'PDF uploaded, chunked, and embedded successfully.'
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to process and embed PDF document.', details: error.message });
  }
});

// Endpoint: Submit user question, perform vector retrieval, and call LLM (Protected)
app.post('/api/query', authenticateToken, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query text is required.' });
    }

    const userDoc = userDocuments[req.user.id];
    if (!userDoc || !userDoc.filename || userDoc.chunks.length === 0) {
      return res.status(400).json({ error: 'No document has been uploaded yet. Please upload a PDF first.' });
    }
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(500).json({ error: 'Gemini API key is not configured.' });
    }

    console.log(`Query from ${req.user.name}: "${query}"`);

    // 1. Generate query embedding
    const queryEmbedResponse = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: query
    });

    let queryVector = null;
    if (queryEmbedResponse.embeddings && queryEmbedResponse.embeddings[0]) {
      queryVector = queryEmbedResponse.embeddings[0].values;
    } else if (queryEmbedResponse.embedding && queryEmbedResponse.embedding.values) {
      queryVector = queryEmbedResponse.embedding.values;
    }

    if (!queryVector) {
      throw new Error("Could not generate embedding for query.");
    }

    // 2. Compute similarity with user's document chunks
    const similarityResults = userDoc.chunks.map(chunk => {
      const score = cosineSimilarity(queryVector, chunk.embedding);
      return {
        id: chunk.id,
        text: chunk.text,
        page: chunk.page,
        similarity: score
      };
    });

    // 3. Sort by similarity and slice top 5
    similarityResults.sort((a, b) => b.similarity - a.similarity);
    const topChunks = similarityResults.slice(0, 5);
    const relevantChunks = topChunks.filter(c => c.similarity > 0.1);
    
    // Construct context representation
    let contextText = "";
    if (relevantChunks.length > 0) {
      contextText = relevantChunks.map((chunk, index) => {
        return `[Source Chunk #${index + 1} | Page ${chunk.page} | Score: ${(chunk.similarity * 100).toFixed(1)}%]\n${chunk.text}\n`;
      }).join('\n');
    } else {
      contextText = "No relevant context found.";
    }

    // 4. Construct RAG Prompt
    const prompt = `You are OmniStudy AI, an intelligent, helpful university learning assistant.
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

    // 5. Query Gemini
    console.log("Requesting answer from Gemini...");
    const chatResponse = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt
    });

    const answer = chatResponse.text || "No response received.";

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

// Endpoint: Clear the current document cache (Protected)
app.post('/api/clear', authenticateToken, (req, res) => {
  delete userDocuments[req.user.id];
  console.log(`Document memory cleared for user: ${req.user.name}`);
  res.json({ success: true, message: "Cleared document memory." });
});

// Start the server
app.listen(port, () => {
  console.log(`OmniStudy AI Backend running on http://localhost:${port}`);
});
