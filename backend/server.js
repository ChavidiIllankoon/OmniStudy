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
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

let dodoClient = null;
if (process.env.DODO_PAYMENTS_API_KEY) {
  try {
    const DodoPayments = require('dodopayments').default;
    dodoClient = new DodoPayments({
      bearerToken: process.env.DODO_PAYMENTS_API_KEY,
      environment: process.env.DODO_ENVIRONMENT || 'test_mode',
    });
  } catch (err) {
    console.error('Failed to initialize DodoPayments client:', err.message);
  }
}

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

async function checkAndResetMonthlyLimits(userId) {
  try {
    const res = await pool.query(
      'SELECT last_reset_date, created_at, ai_questions_used, quizzes_used, flashcards_used, subscription_plan, subscription_status, student_promo_claimed FROM users WHERE id = $1',
      [userId]
    );
    if (res.rows.length === 0) return null;
    
    const user = res.rows[0];
    const now = new Date();
    const lastReset = new Date(user.last_reset_date || user.created_at);
    
    // If a calendar month has elapsed
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
      await pool.query(
        "UPDATE users SET ai_questions_used = 0, quizzes_used = 0, flashcards_used = 0, last_reset_date = NOW() WHERE id = $1",
        [userId]
      );
      user.ai_questions_used = 0;
      user.quizzes_used = 0;
      user.flashcards_used = 0;
      console.log(`Limits reset for user ${userId} for the new month.`);
    }
    return user;
  } catch (err) {
    console.error('Failed to reset monthly limits:', err);
    return null;
  }
}

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
        subscription_plan VARCHAR(50) DEFAULT 'free',
        subscription_status VARCHAR(50) DEFAULT 'inactive',
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        dodo_customer_id VARCHAR(255),
        dodo_subscription_id VARCHAR(255),
        student_promo_claimed BOOLEAN DEFAULT false,
        ai_questions_used INTEGER DEFAULT 0,
        quizzes_used INTEGER DEFAULT 0,
        flashcards_used INTEGER DEFAULT 0,
        last_reset_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration updates for existing database environments
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50) DEFAULT 'free'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'inactive'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_customer_id VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_subscription_id VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS student_promo_claimed BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_questions_used INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS quizzes_used INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS flashcards_used INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS material_concepts (
        id BIGSERIAL PRIMARY KEY,
        material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        abbreviation VARCHAR(10) NOT NULL,
        definition TEXT NOT NULL,
        related TEXT[] NOT NULL,
        study_tips TEXT NOT NULL
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

// Stripe Webhook needs raw body parsing before express.json() is applied
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    if (stripe && process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      // Dynamic fallback for mock webhook tests
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook payload parse error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const subscriptionId = session.subscription;
      const customerId = session.customer;
      
      if (userId) {
        await pool.query(
          "UPDATE users SET subscription_plan = 'premium', subscription_status = 'active', stripe_customer_id = $1, stripe_subscription_id = $2 WHERE id = $3",
          [customerId, subscriptionId, parseInt(userId, 10)]
        );
        console.log(`Stripe Webhook: Upgraded user ${userId} to Premium.`);
      }
    } else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const status = subscription.status; // 'active', 'trialing', 'past_due', 'canceled'
      
      const plan = (status === 'active' || status === 'trialing') ? 'premium' : 'free';
      const billingStatus = status;
      
      await pool.query(
        "UPDATE users SET subscription_plan = $1, subscription_status = $2 WHERE stripe_customer_id = $3",
        [plan, billingStatus, customerId]
      );
      console.log(`Stripe Webhook: Customer ${customerId} updated to ${plan} (${billingStatus}).`);
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      
      await pool.query(
        "UPDATE users SET subscription_plan = 'free', subscription_status = 'canceled' WHERE stripe_customer_id = $1",
        [customerId]
      );
      console.log(`Stripe Webhook: Customer ${customerId} subscription canceled.`);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler database error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// Dodo Webhook needs raw body parsing before express.json() is applied
app.post('/api/billing/dodo-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const webhookId = req.headers['webhook-id'];
  const webhookSignature = req.headers['webhook-signature'];
  const webhookTimestamp = req.headers['webhook-timestamp'];
  
  let event;
  try {
    if (dodoClient && process.env.DODO_WEBHOOK_SECRET && webhookSignature) {
      event = dodoClient.webhooks.unwrap(req.body.toString(), {
        headers: {
          'webhook-id': webhookId,
          'webhook-signature': webhookSignature,
          'webhook-timestamp': webhookTimestamp,
        },
      });
    } else {
      // Dynamic fallback for mock webhook tests
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Dodo Webhook payload parse/verify error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const eventType = event.type || event.event_type;
    const data = event.data;
    
    if (eventType === 'checkout.session.completed') {
      const userId = data.metadata?.userId;
      const subscriptionId = data.subscription_id;
      const customerId = data.customer_id;
      
      if (userId) {
        await pool.query(
          "UPDATE users SET subscription_plan = 'premium', subscription_status = 'active', dodo_customer_id = $1, dodo_subscription_id = $2 WHERE id = $3",
          [customerId, subscriptionId, parseInt(userId, 10)]
        );
        console.log(`Dodo Webhook: Upgraded user ${userId} to Premium.`);
      }
    } else if (eventType === 'subscription.active' || eventType === 'subscription.renewed') {
      const subscriptionId = data.subscription_id;
      const customerId = data.customer_id;
      await pool.query(
        "UPDATE users SET subscription_plan = 'premium', subscription_status = 'active' WHERE dodo_subscription_id = $1 OR dodo_customer_id = $2",
        [subscriptionId, customerId]
      );
      console.log(`Dodo Webhook: Subscription ${subscriptionId} active.`);
    } else if (eventType === 'subscription.cancelled' || eventType === 'subscription.expired' || eventType === 'subscription.paused') {
      const subscriptionId = data.subscription_id;
      const customerId = data.customer_id;
      await pool.query(
        "UPDATE users SET subscription_plan = 'free', subscription_status = 'canceled' WHERE dodo_subscription_id = $1 OR dodo_customer_id = $2",
        [subscriptionId, customerId]
      );
      console.log(`Dodo Webhook: Subscription ${subscriptionId} inactive.`);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error('Dodo Webhook handler database error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

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

/* --- Billing & Subscription Endpoints --- */

// Endpoint: Fetch billing status
app.get('/api/billing/status', authenticateToken, async (req, res) => {
  try {
    const user = await checkAndResetMonthlyLimits(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const countRes = await pool.query('SELECT COUNT(*) as count FROM materials WHERE user_id = $1', [req.user.id]);
    const docCount = parseInt(countRes.rows[0].count, 10);

    const storageRes = await pool.query('SELECT SUM(file_size) as total_size FROM materials WHERE user_id = $1', [req.user.id]);
    const currentStorage = parseInt(storageRes.rows[0].total_size || '0', 10);

    res.json({
      plan: user.subscription_plan,
      status: user.subscription_status,
      stripeConfigured: !!stripe,
      dodoConfigured: !!dodoClient,
      studentPromoClaimed: user.student_promo_claimed,
      usage: {
        materialsCount: docCount,
        storageBytes: currentStorage,
        aiQuestionsUsed: user.ai_questions_used || 0,
        quizzesUsed: user.quizzes_used || 0,
        flashcardsUsed: user.flashcards_used || 0
      }
    });
  } catch (err) {
    console.error('Failed to get billing status:', err);
    res.status(500).json({ error: 'Failed to retrieve billing status.' });
  }
});

// Endpoint: Claim student promotion (Protected)
app.post('/api/billing/claim-student-promo', authenticateToken, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT student_promo_claimed FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    
    if (userRes.rows[0].student_promo_claimed) {
      return res.status(400).json({ error: 'You have already claimed this student offer!' });
    }
    
    await pool.query(
      "UPDATE users SET subscription_plan = 'premium', subscription_status = 'active', student_promo_claimed = true WHERE id = $1",
      [req.user.id]
    );
    
    res.json({ success: true, message: 'Student offer claimed successfully! You unlocked 3 months of Premium.' });
  } catch (err) {
    console.error('Failed to claim student promo:', err);
    res.status(500).json({ error: 'Failed to process student promotion.' });
  }
});

// Endpoint: Create Stripe checkout session
app.post('/api/billing/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured in backend .env' });
    }
    const userRes = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    
    const userDb = userRes.rows[0];
    let stripeCustomerId = userDb.stripe_customer_id;
    
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userDb.email,
        metadata: { userId: req.user.id.toString() }
      });
      stripeCustomerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [stripeCustomerId, req.user.id]);
    }
    
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'OmniStudy Premium Plan',
              description: 'Access to unlimited PDF document uploads and dynamic AI quiz generation.',
            },
            unit_amount: 999, // $9.99
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin || 'http://localhost:5173'}?session_id={CHECKOUT_SESSION_ID}&billing_success=true`,
      cancel_url: `${req.headers.origin || 'http://localhost:5173'}?billing_cancel=true`,
      metadata: {
        userId: req.user.id.toString(),
      },
    });
    
    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe session creation failed:', err);
    res.status(500).json({ error: 'Failed to initiate checkout session.', details: err.message });
  }
});

// Endpoint: Create Dodo checkout session
app.post('/api/billing/create-dodo-checkout-session', authenticateToken, async (req, res) => {
  try {
    if (!dodoClient) {
      return res.status(400).json({ error: 'Dodo Payments is not configured in backend .env' });
    }
    const userRes = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    
    const userDb = userRes.rows[0];
    const productId = process.env.DODO_PRODUCT_ID;
    if (!productId) {
      return res.status(400).json({ error: 'Dodo Payments Product ID is not defined in backend .env' });
    }

    const session = await dodoClient.checkoutSessions.create({
      product_cart: [
        {
          product_id: productId,
          quantity: 1,
        },
      ],
      customer: {
        email: userDb.email,
        name: userDb.name || userDb.email.split('@')[0],
      },
      metadata: {
        userId: req.user.id.toString(),
      },
      return_url: `${req.headers.origin || 'http://localhost:5173'}`,
    });
    
    res.json({ url: session.checkout_url });
  } catch (err) {
    console.error('Dodo session creation failed:', err);
    res.status(500).json({ error: 'Failed to initiate Dodo checkout session.', details: err.message });
  }
});

// Endpoint: Mock sandbox checkout flow (Disabled)
app.post('/api/billing/mock-checkout', authenticateToken, async (req, res) => {
  res.status(403).json({ error: 'Direct credit card payments are disabled. Payments must be processed through a secure payment gateway.' });
});

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
      materialId: material.id,
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

// Endpoint: Fetch materials uploaded by user (Protected)
app.get('/api/materials', authenticateToken, async (req, res) => {
  try {
    const materialsRes = await pool.query(
      'SELECT id, filename, file_size as "fileSize", uploaded_at as "uploadedAt" FROM materials WHERE user_id = $1 ORDER BY id DESC',
      [req.user.id]
    );
    res.json({ materials: materialsRes.rows });
  } catch (err) {
    console.error("Error fetching user materials:", err);
    res.status(500).json({ error: 'Failed to retrieve materials.' });
  }
});

// Endpoint: Fetch concepts for active document (Protected)
app.get('/api/concepts', authenticateToken, async (req, res) => {
  try {
    // 1. Get active material
    const materialRes = await pool.query(
      'SELECT id FROM materials WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [req.user.id]
    );

    if (materialRes.rows.length === 0) {
      return res.json({ concepts: [] });
    }

    const materialId = materialRes.rows[0].id;

    // 2. Fetch concepts
    const conceptsRes = await pool.query(
      'SELECT name, abbreviation, definition, related, study_tips as "studyTips" FROM material_concepts WHERE material_id = $1 ORDER BY id ASC',
      [materialId]
    );

    res.json({ concepts: conceptsRes.rows });
  } catch (err) {
    console.error("Error fetching material concepts:", err);
    res.status(500).json({ error: 'Failed to retrieve material concepts.' });
  }
});

// Endpoint: Fetch concepts for a shared graph (Public)
app.get('/api/public/shared-graph/:materialId', async (req, res) => {
  try {
    const materialId = parseInt(req.params.materialId, 10);
    if (isNaN(materialId)) {
      return res.status(400).json({ error: 'Invalid shared material ID.' });
    }

    const materialRes = await pool.query('SELECT filename FROM materials WHERE id = $1', [materialId]);
    if (materialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Shared graph not found.' });
    }

    const conceptsRes = await pool.query(
      'SELECT name, abbreviation, definition, related, study_tips as "studyTips" FROM material_concepts WHERE material_id = $1 ORDER BY id ASC',
      [materialId]
    );

    res.json({
      filename: materialRes.rows[0].filename,
      concepts: conceptsRes.rows
    });
  } catch (err) {
    console.error("Error fetching shared graph concepts:", err);
    res.status(500).json({ error: 'Failed to retrieve shared graph concepts.' });
  }
});

// Endpoint: Upload PDF, parse text, chunk, and embed (Protected)
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // Check user subscription plan limits and reset counters if needed
    const user = await checkAndResetMonthlyLimits(req.user.id);
    const userPlan = user?.subscription_plan || 'free';

    // Get current uploads count
    const countRes = await pool.query('SELECT COUNT(*) as count FROM materials WHERE user_id = $1', [req.user.id]);
    const docCount = parseInt(countRes.rows[0].count, 10);

    // Get current total storage used
    const storageRes = await pool.query('SELECT SUM(file_size) as total_size FROM materials WHERE user_id = $1', [req.user.id]);
    const currentStorage = parseInt(storageRes.rows[0].total_size || '0', 10);
    const incomingSize = req.file.size;
    const totalStorageWithIncoming = currentStorage + incomingSize;

    if (userPlan === 'free') {
      if (docCount >= 3) {
        return res.status(403).json({ error: "You've reached your Free plan limit. Upgrade to Premium to continue." });
      }
      if (totalStorageWithIncoming > 100 * 1024 * 1024) {
        return res.status(403).json({ error: "You've reached your Free plan limit. Upgrade to Premium to continue." });
      }
      if (incomingSize > 10 * 1024 * 1024) { // 10MB individual file limit
        return res.status(403).json({ error: "Free plan files are limited to 10MB. Upgrade to Premium to upload larger files." });
      }
    } else {
      // Premium Plan limits
      if (docCount >= 100) {
        return res.status(403).json({ error: "You have reached the Premium document upload limit of 100 files." });
      }
      if (totalStorageWithIncoming > 5 * 1024 * 1024 * 1024) { // 5 GB limit
        return res.status(403).json({ error: "You have reached your Premium plan storage limit of 5 GB." });
      }
      if (incomingSize > 100 * 1024 * 1024) { // 100MB individual file limit
        return res.status(403).json({ error: "Premium plan files are limited to 100MB." });
      }
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

      // Perform concept extraction using Gemini (as per the diagram path)
      console.log("Extracting key concepts from PDF text...");
      const sampleText = plainChunks.slice(0, 8).map(c => c.text).join('\n\n').substring(0, 8000);
      
      const conceptPrompt = `You are an academic curriculum designer. Analyze the following lecture/study text and extract exactly 5 key concepts, topics, or definitions.
For each concept, provide:
1. "name": A short title of the concept (1-3 words) (e.g. "Polymorphism", "Database Index").
2. "abbreviation": A 2-3 character abbreviation for the concept nodes in a graph (e.g. "PM", "IDX").
3. "definition": A clear 1-2 sentence academic explanation of the concept.
4. "related": An array of other concept names in this list that are related/linked.
5. "studyTips": A short, actionable advice capsule for studying this concept.

Respond ONLY with a valid raw JSON array of objects, with no markdown code block formatting, no backticks, no comments, and no extra text.

Text Content:
${sampleText}`;

      const chatModel = new ChatGoogleGenerativeAI({
        apiKey: apiKey,
        model: "gemini-3.5-flash",
        temperature: 0.3
      });

      let extractedConcepts = [];
      try {
        const response = await chatModel.invoke(conceptPrompt);
        let cleanJson = (response.content || "").trim();
        if (cleanJson.startsWith('```json')) cleanJson = cleanJson.substring(7);
        if (cleanJson.startsWith('```')) cleanJson = cleanJson.substring(3);
        if (cleanJson.endsWith('```')) cleanJson = cleanJson.substring(0, cleanJson.length - 3);
        cleanJson = cleanJson.trim();
        
        extractedConcepts = JSON.parse(cleanJson);
      } catch (err) {
        console.error("Failed to extract dynamic concepts, utilizing fallback templates:", err);
        extractedConcepts = [
          {
            name: "Lecture Overview",
            abbreviation: "LOV",
            definition: "The core introduction and foundational learning outcomes covered in the slide material.",
            related: ["Core Concepts"],
            studyTips: "Review this section first to establish a context framework."
          },
          {
            name: "Core Concepts",
            abbreviation: "CCS",
            definition: "Primary terms, theories, and models key to understanding the slide context.",
            related: ["Lecture Overview", "Practical Methods"],
            studyTips: "Focus on definitions and real-world examples."
          },
          {
            name: "Practical Methods",
            abbreviation: "PMT",
            definition: "How key concepts are applied practically in lab assignments and programming exercises.",
            related: ["Core Concepts", "Advanced Extensions"],
            studyTips: "Code or draw out diagrams to understand step-by-step applications."
          },
          {
            name: "Advanced Extensions",
            abbreviation: "AEX",
            definition: "Topics expanding past core curriculum for higher-order learning challenges.",
            related: ["Practical Methods"],
            studyTips: "Cross-reference with reference materials."
          }
        ];
      }

      // Save concepts to PostgreSQL
      for (const concept of extractedConcepts) {
        const relatedArray = Array.isArray(concept.related) ? concept.related : [];
        await client.query(
          'INSERT INTO material_concepts (material_id, name, abbreviation, definition, related, study_tips) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            materialId,
            concept.name || "Untitled Concept",
            concept.abbreviation || "CON",
            concept.definition || "No definition available.",
            relatedArray,
            concept.studyTips || "No study tips available."
          ]
        );
      }
      
      await client.query('COMMIT');
      console.log("PostgreSQL vector and concept indexing complete!");
      
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

    // Check user subscription limits
    const user = await checkAndResetMonthlyLimits(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const userPlan = user.subscription_plan || 'free';
    const questionsUsed = user.ai_questions_used || 0;

    if (userPlan === 'free') {
      if (questionsUsed >= 20) {
        return res.status(403).json({ error: "You've reached your Free plan limit. Upgrade to Premium to continue." });
      }
    } else {
      if (questionsUsed >= 500) {
        return res.status(403).json({ error: "You've reached your Premium plan limit of 500 questions this month." });
      }
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

    // Increment user questions usage count
    await pool.query('UPDATE users SET ai_questions_used = ai_questions_used + 1 WHERE id = $1', [req.user.id]);

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

    // Check user subscription limits
    const user = await checkAndResetMonthlyLimits(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const userPlan = user.subscription_plan || 'free';
    const quizzesUsed = user.quizzes_used || 0;

    if (userPlan === 'free') {
      if (quizzesUsed >= 3) {
        return res.status(403).json({ error: "You've reached your Free plan limit. Upgrade to Premium to continue." });
      }
    } else {
      if (quizzesUsed >= 100) {
        return res.status(403).json({ error: "You've reached your Premium plan limit of 100 quizzes this month." });
      }
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

    // Increment quizzes usage count
    await pool.query('UPDATE users SET quizzes_used = quizzes_used + 1 WHERE id = $1', [req.user.id]);

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
