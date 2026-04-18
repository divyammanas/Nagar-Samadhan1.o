const mongoose = require('mongoose');
const connectDB = require('./config/database');
require('dotenv').config();

const Report = require('./models/Report');
const Task = require('./models/Task');
const User = require('./models/User');

const clearDatabase = async () => {
    try {
        await connectDB();
        
        console.log('🧹 Starting database cleanup...');
        
        const reportCount = await Report.countDocuments();
        const taskCount = await Task.countDocuments();
        const userCount = await User.countDocuments();
        
        console.log(`📊 Current counts:`);
        console.log(`   Reports: ${reportCount}`);
        console.log(`   Tasks: ${taskCount}`);
        console.log(`   Users: ${userCount}`);
        
        await Report.deleteMany({});
        console.log('✅ Cleared Reports collection');
        
        await Task.deleteMany({});
        console.log('✅ Cleared Tasks collection');
        
        await User.deleteMany({});
        console.log('✅ Cleared Users collection');
        
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: 'uploads'
        });
        
        try {
            await bucket.drop();
            console.log('✅ Cleared GridFS uploads bucket');
        } catch (error) {
            if (error.message.includes('ns not found')) {
                console.log('ℹ️  GridFS uploads bucket was already empty');
            } else {
                console.log('⚠️  Could not clear GridFS bucket:', error.message);
            }
        }
        
        console.log('🎉 Database cleared successfully!');
        
    } catch (error) {
        console.error('❌ Error clearing database:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔄 Database connection closed');
        process.exit(0);
    }
};

clearDatabase();