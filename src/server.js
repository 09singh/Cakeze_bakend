require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env'),
});

const app = require('./app');
const connectDatabase = require('./config/db');

const PORT = Number(process.env.PORT || 5000);

async function startServer() {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET is missing or shorter than 32 characters.');
    }

    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`Cakezee backend listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start Cakezee backend:', error.message);
    process.exit(1);
  }
}

startServer();