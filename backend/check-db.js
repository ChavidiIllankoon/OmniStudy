require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function check() {
  try {
    console.log('Connecting to database:', process.env.DB_NAME);
    const res = await pool.query('SELECT id, name, email, subscription_plan, subscription_status FROM users');
    console.log('\n--- OMNISTUDY DATABASE - USER PLANS ---');
    if (res.rows.length === 0) {
      console.log('No user accounts found in the database.');
    } else {
      console.table(res.rows);
    }
  } catch (err) {
    console.error('\nDatabase query error:', err.message);
  } finally {
    await pool.end();
  }
}

check();
