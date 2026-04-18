const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    public_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, 'Name cannot be more than 100 characters']
    },
    mobile: {
        type: String,
        required: false,
        match: [/^[0-9]{10}$/, 'Mobile number must be 10 digits']
    },
    id_number: {
        type: String,
        required: false,
        trim: true
    },
    description: {
        type: String,
        required: true,
        trim: true,
        minlength: [5, 'Description must be at least 5 characters'],
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    category: {
        type: String,
        required: true,
        validate: {
            validator: function(value) {
                const allowedCategories = [
                    'Illegal Dumping',
                    'Public Health and Sanitation',
                    'Road Repair / Potholes',
                    'Streetlight Malfunction',
                    'Water Leakage / Sewage',
                    'Public Space Obstruction',
                    'Fallen Trees / Obstructions',
                    'Garbage & Sanitation',
                    'Other'
                ];
                return allowedCategories.includes(value) || value.startsWith('Other:');
            },
            message: 'Invalid category provided'
        }
    },
    custom_category: {
        type: String,
        trim: true,
        maxlength: [100, 'Custom category cannot exceed 100 characters']
    },
    location: {
        city: {
            type: String,
            required: true,
            trim: true
        },
        coordinates: {
            type: {
                type: String,
                enum: ['Point'],
                required: function() { return this.coordinates && this.coordinates.coordinates; }
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: function() { return this.coordinates && this.coordinates.type; },
                validate: {
                    validator: function(val) {
                        return val && val.length === 2 && 
                               !isNaN(val[0]) && !isNaN(val[1]) &&
                               val[0] >= -180 && val[0] <= 180 &&
                               val[1] >= -90 && val[1] <= 90;
                    },
                    message: 'Coordinates must be [longitude, latitude] with valid ranges'
                }
            }
        },
        address: {
            type: String,
            trim: true
        },
        // Manual address support
        address_type: {
            type: String,
            enum: ['dropdown', 'manual', 'gps'],
            default: 'dropdown'
        },
        has_gps: {
            type: Boolean,
            default: false
        },
        manual_address: {
            city: {
                type: String,
                trim: true
            },
            state: {
                type: String,
                trim: true
            },
            detailed_address: {
                type: String,
                trim: true
            }
        }
    },
    media: [{
        filename: String,
        originalname: String,
        mimetype: String,
        size: Number,
        path: String,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'low',
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'acknowledged', 'in_progress', 'resolved', 'rejected'],
        default: 'pending',
        index: true
    },
    assigned_department: {
        type: String,
        required: true,
        enum: [
            'Sanitation',
            'Public Works',
            'Electrical',
            'Water & Sewerage',
            'Parks & Gardens',
            'General Services'
        ],
        index: true
    },
    assigned_to: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    resolution_notes: {
        type: String,
        trim: true,
        maxlength: [500, 'Resolution notes cannot exceed 500 characters']
    },
    resolved_at: {
        type: Date,
        default: null
    },
    estimated_completion: {
        type: Date,
        default: null
    },
    urgency_factors: {
        similar_reports_count: {
            type: Number,
            default: 0
        },
        location_matches: {
            type: Number,
            default: 0
        },
        category_matches: {
            type: Number,
            default: 0
        },
        upvote_count: {
            type: Number,
            default: 0
        },
        calculation_date: {
            type: Date,
            default: Date.now
        }
    },
    citizen_rating: {
        type: Number,
        min: 1,
        max: 5,
        default: null
    },
    citizen_feedback: {
        type: String,
        trim: true,
        maxlength: [500, 'Feedback cannot exceed 500 characters']
    },
    upvotes: {
        count: {
            type: Number,
            default: 0,
            min: 0
        },
        voters: [{
            device_fingerprint: {
                type: String,
                required: true
            },
            ip_address: {
                type: String,
                required: true
            },
            user_agent: {
                type: String,
                required: true
            },
            voted_at: {
                type: Date,
                default: Date.now
            }
        }],
        last_upvote: {
            type: Date,
            default: null
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Create geospatial index for location-based queries
reportSchema.index({ "location.coordinates": "2dsphere" });

// Create compound indexes for efficient queries
reportSchema.index({ status: 1, priority: 1, createdAt: -1 });
reportSchema.index({ assigned_department: 1, status: 1 });
reportSchema.index({ category: 1, createdAt: -1 });
reportSchema.index({ 'upvotes.count': -1 }); // Index for sorting by upvotes
reportSchema.index({ 'upvotes.voters.device_fingerprint': 1 }); // Index for duplicate vote checking

// Virtual for resolution time
reportSchema.virtual('resolution_time').get(function() {
    if (this.resolved_at && this.createdAt) {
        return Math.round((this.resolved_at - this.createdAt) / (1000 * 60 * 60)); // hours
    }
    return null;
});

// Virtual for age in hours
reportSchema.virtual('age_hours').get(function() {
    return Math.round((Date.now() - this.createdAt) / (1000 * 60 * 60));
});

// Pre-save middleware to generate public_id
reportSchema.pre('save', function(next) {
    if (!this.public_id) {
        this.public_id = 'LOC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
    }
    next();
});

// Pre-validate middleware to ensure public_id is set
reportSchema.pre('validate', function(next) {
    if (!this.public_id) {
        this.public_id = 'LOC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
    }
    next();
});

// Pre-save middleware for status changes
reportSchema.pre('save', function(next) {
    if (this.isModified('status') && this.status === 'resolved' && !this.resolved_at) {
        this.resolved_at = new Date();
    }
    next();
});

// Static method to find reports by location proximity
reportSchema.statics.findNearby = function(longitude, latitude, maxDistance = 2000) {
    return this.find({
        "location.coordinates": {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: [longitude, latitude]
                },
                $maxDistance: maxDistance // meters
            }
        }
    });
};

// Static method to get priority statistics
reportSchema.statics.getPriorityStats = function() {
    return this.aggregate([
        {
            $group: {
                _id: '$priority',
                count: { $sum: 1 }
            }
        }
    ]);
};

// Static method to get department workload
reportSchema.statics.getDepartmentWorkload = function() {
    return this.aggregate([
        {
            $group: {
                _id: {
                    department: '$assigned_department',
                    status: '$status'
                },
                count: { $sum: 1 }
            }
        },
        {
            $group: {
                _id: '$_id.department',
                statuses: {
                    $push: {
                        status: '$_id.status',
                        count: '$count'
                    }
                },
                total: { $sum: '$count' }
            }
        }
    ]);
};

module.exports = mongoose.model('Report', reportSchema);