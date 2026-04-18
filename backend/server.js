const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const os = require('os');
const crypto = require('crypto');
const mongoose = require('mongoose');
const GridFSBucket = require('mongodb').GridFSBucket;
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Database connection
const connectDB = require('./config/database');

// Models
const Report = require('./models/Report');
const Task = require('./models/Task');
const User = require('./models/User');

// Services
const PriorityService = require('./services/priorityService');

// Connect to database
connectDB();

// Simple ID generator to replace nanoid
function generateId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Convert location format to MongoDB format with manual address support
function convertLocationFormat(location, latitude, longitude, addressData = {}) {
    const {
        addressType,
        manualCity,
        manualState,
        manualAddress,
        hasGps
    } = addressData;
    
    const locationData = {
        city: location || 'Unknown',
        address_type: addressType || 'dropdown',
        has_gps: hasGps || false
    };
    
    // Add manual address fields if provided
    if (addressType === 'manual') {
        locationData.manual_address = {
            city: manualCity,
            state: manualState,
            detailed_address: manualAddress
        };
    }
    
    // Only include coordinates if we have valid latitude and longitude
    if (latitude && longitude && !isNaN(parseFloat(latitude)) && !isNaN(parseFloat(longitude))) {
        locationData.coordinates = {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
        };
        locationData.has_gps = true;
    }
    // Don't include coordinates object at all if we don't have valid coordinates
    
    return locationData;
}

// Generate device fingerprint from request
function generateDeviceFingerprint(req) {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const acceptLanguage = req.headers['accept-language'] || 'unknown';
    const acceptEncoding = req.headers['accept-encoding'] || 'unknown';
    const connection = req.headers['connection'] || 'unknown';
    
    // Create fingerprint from multiple browser characteristics
    const fingerprintData = `${userAgent}-${acceptLanguage}-${acceptEncoding}-${connection}`;
    return crypto.createHash('sha256').update(fingerprintData).digest('hex');
}

// Get client IP address
function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           req.ip || 
           'unknown';
}


const app = express();
app.use(cors());
app.use(cors({
  origin: [
    "https://your-app.vercel.app",  // add after deploying
    "http://localhost:3000"           // keep for local dev
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Use memory storage for temporary file handling
const storage = multer.memoryStorage();

// Configure multer with GridFS storage and file validation
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB limit for videos
  },
  fileFilter: function (req, file, cb) {
    // Check file type
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      // Additional size check for images (10MB)
      if (file.mimetype.startsWith('image/') && req.headers['content-length'] > 10 * 1024 * 1024) {
        cb(new Error('Image files must be less than 10MB'));
        return;
      }
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'));
    }
  }
});

// Initialize GridFS bucket for file operations
let gfsBucket;
mongoose.connection.once('open', () => {
  gfsBucket = new GridFSBucket(mongoose.connection.db, {
    bucketName: 'media'
  });
  console.log('GridFS initialized');
});

// Function to upload buffer to GridFS
function uploadToGridFS(buffer, filename, mimetype) {
  return new Promise((resolve, reject) => {
    if (!gfsBucket) {
      return reject(new Error('GridFS not initialized'));
    }
    
    const uploadStream = gfsBucket.openUploadStream(filename, {
      contentType: mimetype
    });
    
    uploadStream.on('error', (error) => {
      reject(error);
    });
    
    uploadStream.on('finish', () => {
      resolve({
        id: uploadStream.id,
        filename: filename,
        size: buffer.length,
        contentType: mimetype
      });
    });
    
    uploadStream.end(buffer);
  });
}

// Serve static frontend
app.use('/', express.static(path.join(__dirname, '..', 'public')));

// GridFS file serving endpoint
app.get('/api/media/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        console.log(`📁 Request for media file: ${filename}`);
        
        if (!gfsBucket) {
            console.error('❌ GridFS not initialized');
            return res.status(500).json({ error: 'GridFS not initialized' });
        }
        
        // Find file by filename using async/await
        const files = await gfsBucket.find({ filename: filename }).toArray();
        
        if (!files || files.length === 0) {
            console.log(`❌ File not found in GridFS: ${filename}`);
            return res.status(404).json({ error: 'File not found' });
        }
        
        const file = files[0];
        console.log(`✅ File found: ${file.filename}, Size: ${file.length}, Type: ${file.contentType}`);
        
        // Set appropriate headers
        res.set({
            'Content-Type': file.contentType || 'application/octet-stream',
            'Content-Length': file.length,
            'Content-Disposition': `inline; filename="${file.filename}"`
        });
        
        // Stream the file
        const downloadStream = gfsBucket.openDownloadStreamByName(filename);
        
        downloadStream.on('error', (error) => {
            console.error('❌ GridFS stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'File streaming error' });
            }
        });
        
        downloadStream.on('end', () => {
            console.log(`✅ File streamed successfully: ${filename}`);
        });
        
        downloadStream.pipe(res);
        
    } catch (error) {
        console.error('❌ Media serving error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create a report (with required image/video)
app.post('/api/reports', (req, res, next) => {
  console.log('📁 File upload request received');
  
  upload.single('media')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error('❌ Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Images must be less than 10MB, videos less than 20MB.' });
      }
      return res.status(400).json({ error: 'File upload error: ' + err.message });
    } else if (err) {
      console.error('❌ Upload error:', err);
      return res.status(400).json({ error: err.message });
    }
    
    // Check if file was uploaded
    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ error: 'Photo or video evidence is required. Please upload a file.' });
    }
    
    console.log('✅ File uploaded successfully:', {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      id: req.file.id
    });
    
    next();
  });
}, async (req, res) => {
  try {
    const name = req.body.name || req.body.fullName;
    const mobile = req.body.mobile || req.body.mobileNumber;
    const id_number = req.body.id_number || req.body.idNumber;
    const description = req.body.description || 'No description provided';
    let category = req.body.category || req.body.issueCategory || 'Other';
    const location = req.body.location;
    const latitude = req.body.latitude ? parseFloat(req.body.latitude) : null;
    const longitude = req.body.longitude ? parseFloat(req.body.longitude) : null;
    
    // Upload file to GridFS first
    let uploadedFile = null;
    if (req.file) {
      const filename = Date.now() + '-' + Math.round(Math.random()*1E9) + path.extname(req.file.originalname);
      console.log('📁 Uploading file to GridFS:', filename);
      
      try {
        uploadedFile = await uploadToGridFS(req.file.buffer, filename, req.file.mimetype);
        console.log('✅ File uploaded to GridFS successfully:', uploadedFile);
      } catch (uploadError) {
        console.error('❌ GridFS upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload file to storage. Please try again.' });
      }
    }
    
    // Manual address fields
    const addressType = req.body.address_type || 'dropdown';
    const manualCity = req.body.manualCity || null;
    const manualState = req.body.manualState || null;
    const manualAddress = req.body.manualAddress || null;
    const hasGps = req.body.has_gps === 'true';
    
    
    // Validation
    if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name is required' });
    }
    
    if (!description || description.trim().length < 5) {
        return res.status(400).json({ error: 'Description must be at least 5 characters long' });
    }
    
    if (!location || location.trim().length === 0) {
        return res.status(400).json({ error: 'Location is required' });
    }
    
    // Handle "Other" category with custom description
    if (category === 'Other' && req.body.otherCategory) {
        category = `Other: ${req.body.otherCategory}`;
    }
    
    // Convert location format for MongoDB with manual address support
    const locationData = convertLocationFormat(location, latitude, longitude, {
        addressType,
        manualCity,
        manualState, 
        manualAddress,
        hasGps
    });
    
    // Prepare media data for GridFS
    let media = [];
    if (uploadedFile) {
        media.push({
            filename: uploadedFile.filename,
            originalname: req.file.originalname,
            mimetype: uploadedFile.contentType,
            size: uploadedFile.size,
            gridfs_id: uploadedFile.id
        });
    }

    // Simple routing: map category keywords to department
    let assigned_department = 'General Services';
    const cat = category.toLowerCase();
    if (cat.includes('illegal dumping')) assigned_department = 'Sanitation';
    else if (cat.includes('public health and sanitation') || cat.includes('sanitation') || cat.includes('garbage')) assigned_department = 'Sanitation';
    else if (cat.includes('streetlight') || cat.includes('light')) assigned_department = 'Electrical';
    else if (cat.includes('water') || cat.includes('sewage')) assigned_department = 'Water & Sewerage';
    else if (cat.includes('road repair') || cat.includes('potholes')) assigned_department = 'Public Works';
    else if (cat.includes('public space obstruction') || cat.includes('obstruction') || cat.includes('fallen trees')) assigned_department = 'Parks & Gardens';
    
    // Calculate smart priority using the new service
    const { priority, urgencyFactors } = await PriorityService.calculateSmartPriority({
        category,
        location: locationData
    });
    
    // Create new report in MongoDB
    const newReport = new Report({
        name,
        mobile,
        id_number,
        description,
        category,
        custom_category: req.body.otherCategory || null,
        location: locationData,
        media,
        priority,
        status: 'pending',
        assigned_department,
        urgency_factors: urgencyFactors
    });
    
    const savedReport = await newReport.save();
    // Create associated task
    const newTask = new Task({
        report_id: savedReport._id,
        department: assigned_department,
        priority: priority,
        created_by: savedReport._id // For now, using report ID as creator
    });
    
    await newTask.save();
    
    res.json({
        success: true,
        public_id: savedReport.public_id,
        id: savedReport._id,
        tracking_url: `/report.html?id=${savedReport.public_id}`,
        priority: priority
    });
    
  } catch (err) {
    console.error('Error creating report:', err);
    res.status(500).json({ 
        error: 'Failed to create report',
        message: err.message 
    });
  }
});

// List reports (admin)
app.get('/api/reports', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        
        const filter = {};
        
        // Apply filters
        if (req.query.status) filter.status = req.query.status;
        if (req.query.priority) filter.priority = req.query.priority;
        if (req.query.department) filter.assigned_department = req.query.department;
        if (req.query.category) filter.category = req.query.category;
        
        // Determine sort order
        let sortOptions = {};
        const sortBy = req.query.sort || 'created_at';
        const sortOrder = req.query.order === 'asc' ? 1 : -1;
        
        switch (sortBy) {
            case 'upvotes':
                sortOptions = { 'upvotes.count': sortOrder, createdAt: -1 };
                break;
            case 'priority':
                // Custom priority sorting: urgent -> high -> medium -> low
                const priorityOrder = { 'urgent': 4, 'high': 3, 'medium': 2, 'low': 1 };
                // Note: MongoDB doesn't support custom value sorting directly, so we'll sort after fetching
                sortOptions = { createdAt: -1 }; // Default sort, will be overridden later
                break;
            case 'created_at':
            default:
                sortOptions = { createdAt: sortOrder };
                break;
        }
        
        let reports = await Report.find(filter)
            .populate('assigned_to', 'name employee_id')
            .sort(sortOptions)
            .skip(skip)
            .limit(limit)
            .lean();
            
        // Handle priority sorting manually if needed
        if (sortBy === 'priority') {
            const priorityOrder = { 'urgent': 4, 'high': 3, 'medium': 2, 'low': 1 };
            reports.sort((a, b) => {
                const priorityA = priorityOrder[a.priority] || 0;
                const priorityB = priorityOrder[b.priority] || 0;
                return sortOrder === 1 ? priorityA - priorityB : priorityB - priorityA;
            });
        }
            
        const total = await Report.countDocuments(filter);
        
        // Convert MongoDB format to match frontend expectations
        const formattedReports = reports.map(report => ({
            id: report._id,
            public_id: report.public_id,
            name: report.name,
            description: report.description,
            category: report.category,
            location: report.location.city,
            latitude: (report.location.coordinates && report.location.coordinates.coordinates && report.location.coordinates.coordinates.length >= 2) ? report.location.coordinates.coordinates[1] : null,
            longitude: (report.location.coordinates && report.location.coordinates.coordinates && report.location.coordinates.coordinates.length >= 2) ? report.location.coordinates.coordinates[0] : null,
            media_path: report.media.length > 0 ? `/api/media/${report.media[0].filename}` : null,
            priority: report.priority,
            status: report.status,
            assigned_department: report.assigned_department,
            assigned_to: report.assigned_to,
            created_at: report.createdAt,
            urgency_factors: report.urgency_factors,
            upvotes: report.upvotes?.count || 0,
            // Include location data for manual address support
            location_data: {
                address_type: report.location.address_type || 'dropdown',
                has_gps: report.location.has_gps || false,
                manual_address: report.location.manual_address || null
            }
        }));
        
        res.json({
            reports: formattedReports,
            pagination: {
                current: page,
                total: Math.ceil(total / limit),
                count: reports.length,
                total_records: total
            }
        });
        
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// Get single report by public_id
app.get('/api/reports/:public_id', async (req, res) => {
    try {
        const report = await Report.findOne({ public_id: req.params.public_id })
            .populate('assigned_to', 'name employee_id department');
            
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const tasks = await Task.find({ report_id: report._id })
            .populate('assigned_to', 'name employee_id')
            .populate('created_by', 'name employee_id');
            
        // Get media path from GridFS
        let mediaPath = null;
        if (report.media && report.media.length > 0) {
            mediaPath = `/api/media/${report.media[0].filename}`;
        }
        
        // Format response to match frontend expectations
        const formattedReport = {
            id: report._id,
            public_id: report.public_id,
            name: report.name,
            description: report.description,
            category: report.category,
            location: report.location.city,
            latitude: (report.location.coordinates && report.location.coordinates.coordinates && report.location.coordinates.coordinates.length >= 2) ? report.location.coordinates.coordinates[1] : null,
            longitude: (report.location.coordinates && report.location.coordinates.coordinates && report.location.coordinates.coordinates.length >= 2) ? report.location.coordinates.coordinates[0] : null,
            media_path: mediaPath,
            priority: report.priority,
            status: report.status,
            assigned_department: report.assigned_department,
            assigned_to: report.assigned_to,
            created_at: report.createdAt,
            tasks: tasks,
            // Include location data for manual address support
            location_data: {
                address_type: report.location.address_type || 'dropdown',
                has_gps: report.location.has_gps || false,
                manual_address: report.location.manual_address || null
            }
        };
        
        res.json(formattedReport);
        
    } catch (error) {
        console.error('Error fetching report:', error);
        res.status(500).json({ error: 'Failed to fetch report' });
    }
});

// Upvote a report
app.post('/api/reports/:public_id/upvote', async (req, res) => {
    try {
        const report = await Report.findOne({ public_id: req.params.public_id });
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        // Generate device fingerprint and get IP
        const deviceFingerprint = generateDeviceFingerprint(req);
        const ipAddress = getClientIP(req);
        const userAgent = req.headers['user-agent'] || 'unknown';
        
        // Check if this device has already voted
        const existingVote = report.upvotes.voters.find(voter => 
            voter.device_fingerprint === deviceFingerprint
        );
        
        if (existingVote) {
            return res.status(409).json({ 
                error: 'Already voted',
                message: 'This device has already upvoted this report',
                voted_at: existingVote.voted_at
            });
        }
        
        // Add the vote
        report.upvotes.voters.push({
            device_fingerprint: deviceFingerprint,
            ip_address: ipAddress,
            user_agent: userAgent,
            voted_at: new Date()
        });
        
        report.upvotes.count += 1;
        report.upvotes.last_upvote = new Date();
        
        await report.save();
        
        // Check if upvotes should trigger priority recalculation
        const oldPriority = report.priority;
        let newPriority = oldPriority;
        
        // Priority boost based on upvotes
        if (report.upvotes.count >= 25) {
            newPriority = 'high';
        } else if (report.upvotes.count >= 10) {
            // Boost priority by one level if not already high/urgent
            if (oldPriority === 'low') newPriority = 'medium';
            else if (oldPriority === 'medium') newPriority = 'high';
        }
        
        // Update priority if changed
        if (newPriority !== oldPriority) {
            report.priority = newPriority;
            await report.save();
            
            console.log(`⬆️ Report ${report.public_id} priority boosted from ${oldPriority} to ${newPriority} due to ${report.upvotes.count} upvotes`);
        }
        
        res.json({
            success: true,
            message: 'Upvote recorded successfully',
            upvotes: report.upvotes.count,
            priority: report.priority,
            priority_boosted: newPriority !== oldPriority
        });
        
    } catch (error) {
        console.error('Error recording upvote:', error);
        res.status(500).json({ error: 'Failed to record upvote' });
    }
});

// Check if user can vote on a report (returns vote status)
app.get('/api/reports/:public_id/vote-status', async (req, res) => {
    try {
        const report = await Report.findOne({ public_id: req.params.public_id });
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const deviceFingerprint = generateDeviceFingerprint(req);
        const hasVoted = report.upvotes.voters.some(voter => 
            voter.device_fingerprint === deviceFingerprint
        );
        
        res.json({
            can_vote: !hasVoted,
            has_voted: hasVoted,
            upvotes: report.upvotes.count,
            last_upvote: report.upvotes.last_upvote
        });
        
    } catch (error) {
        console.error('Error checking vote status:', error);
        res.status(500).json({ error: 'Failed to check vote status' });
    }
});

// Admin: update task status / assign
app.post('/api/tasks/:id/update', async (req, res) => {
    try {
        const taskId = req.params.id;
        const status = req.body.status || 'in_progress';
        const assigned_to = req.body.assigned_to || null;
        const notes = req.body.notes || null;
        
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        
        // Update task
        task.status = status;
        task.assigned_to = assigned_to;
        task.notes = notes;
        
        if (status === 'completed' || status === 'resolved') {
            task.actual_completion = new Date();
        }
        
        await task.save();
        
        // Update corresponding report status
        await Report.findByIdAndUpdate(task.report_id, { 
            status: status,
            assigned_to: assigned_to,
            resolution_notes: notes
        });
        
        res.json({ success: true, task_id: taskId, changes: 1 });
        
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Recalculate priorities for all reports
app.post('/api/recalculate-priorities', async (req, res) => {
    try {
        const results = await PriorityService.recalculateAllPriorities();
        res.json({
            success: true,
            message: 'Priorities recalculated successfully',
            results
        });
    } catch (error) {
        console.error('Error recalculating priorities:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to recalculate priorities',
            details: error.message 
        });
    }
});

// Priority and analytics endpoints
app.get('/api/priority/stats', async (req, res) => {
    try {
        const stats = await PriorityService.getPriorityStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching priority stats:', error);
        res.status(500).json({ error: 'Failed to fetch priority stats' });
    }
});

app.post('/api/priority/recalculate', async (req, res) => {
    try {
        const results = await PriorityService.recalculateAllPriorities();
        res.json({
            success: true,
            message: 'Priorities recalculated successfully',
            results
        });
    } catch (error) {
        console.error('Error recalculating priorities:', error);
        res.status(500).json({ error: 'Failed to recalculate priorities' });
    }
});

app.get('/api/priority/urgent', async (req, res) => {
    try {
        const urgentReports = await PriorityService.getUrgentReports();
        res.json(urgentReports);
    } catch (error) {
        console.error('Error fetching urgent reports:', error);
        res.status(500).json({ error: 'Failed to fetch urgent reports' });
    }
});

app.get('/api/analytics/clusters', async (req, res) => {
    try {
        const radius = parseInt(req.query.radius) || 1000;
        const clusters = await PriorityService.getLocationClusters(radius);
        res.json(clusters);
    } catch (error) {
        console.error('Error fetching location clusters:', error);
        res.status(500).json({ error: 'Failed to fetch location clusters' });
    }
});

app.get('/api/analytics/trends', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const trends = await PriorityService.getPriorityTrends(days);
        res.json(trends);
    } catch (error) {
        console.error('Error fetching priority trends:', error);
        res.status(500).json({ error: 'Failed to fetch priority trends' });
    }
});

// Dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const totalReports = await Report.countDocuments();
        const pendingReports = await Report.countDocuments({ status: 'pending' });
        const inProgressReports = await Report.countDocuments({ status: 'in_progress' });
        const resolvedReports = await Report.countDocuments({ status: 'resolved' });
        
        const priorityStats = await Report.aggregate([
            {
                $group: {
                    _id: '$priority',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        const departmentStats = await Report.aggregate([
            {
                $group: {
                    _id: '$assigned_department',
                    total: { $sum: 1 },
                    pending: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'pending'] }, 1, 0]
                        }
                    },
                    resolved: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0]
                        }
                    }
                }
            }
        ]);
        
        res.json({
            overview: {
                total: totalReports,
                pending: pendingReports,
                in_progress: inProgressReports,
                resolved: resolvedReports
            },
            priorities: priorityStats,
            departments: departmentStats
        });
        
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
    }
});

// Simple endpoint to serve report page by public id
app.get('/report.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'report.html'));
});

// Function to get the local network IP address
function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        const addresses = interfaces[interfaceName];
        for (const address of addresses) {
            // Skip loopback, internal, and IPv6 addresses
            if (!address.internal && address.family === 'IPv4') {
                return address.address;
            }
        }
    }
    return 'localhost'; // Fallback
}

const PORT = process.env.PORT || 3000;
const networkIP = getNetworkIP();

app.listen(PORT, '0.0.0.0', () => {
    console.log('Server started on port', PORT);
    console.log('Local access: http://localhost:' + PORT);
    console.log('Network access: http://' + networkIP + ':' + PORT);
    console.log('Mobile access: Use http://' + networkIP + ':' + PORT + ' on devices connected to the same WiFi');
});
