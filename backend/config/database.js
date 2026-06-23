const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
        console.log("MONGO_URI exists:", !!mongoUri);
        console.log("URI length:", mongoUri?.length);
        if (!mongoUri) {
            throw new Error('MONGO_URI or MONGODB_URI is required');
        }

        const conn = await mongoose.connect(mongoUri);

        console.log(`MongoDB Connected: ${conn.connection.host}`);
        console.log(`Database: ${conn.connection.name}`);
        
        // Log connection status
        mongoose.connection.on('connected', () => {
            console.log('✅ Mongoose connected to MongoDB');
        });

        mongoose.connection.on('error', (err) => {
            console.error('❌ Mongoose connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('⚠️ Mongoose disconnected from MongoDB');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('🔄 Mongoose connection closed due to app termination');
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Database connection error:', error);
        process.exit(1);
    }
};

module.exports = connectDB;
