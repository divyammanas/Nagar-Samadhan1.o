const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    report_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Report',
        required: true,
        index: true
    },
    department: {
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
    status: {
        type: String,
        enum: ['open', 'assigned', 'in_progress', 'completed', 'resolved', 'rejected'],
        default: 'open',
        index: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'low',
        index: true
    },
    notes: {
        type: String,
        trim: true,
        maxlength: [1000, 'Notes cannot exceed 1000 characters']
    },
    admin_notes: {
        type: String,
        trim: true,
        maxlength: [1000, 'Admin notes cannot exceed 1000 characters']
    },
    estimated_completion: {
        type: Date,
        default: null
    },
    actual_completion: {
        type: Date,
        default: null
    },
    work_updates: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        update: {
            type: String,
            required: true,
            trim: true,
            maxlength: [500, 'Update cannot exceed 500 characters']
        },
        updated_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        status_change: {
            from: String,
            to: String
        },
        images: [{
            filename: String,
            path: String,
            description: String,
            uploadedAt: {
                type: Date,
                default: Date.now
            }
        }]
    }],
    materials_used: [{
        item: {
            type: String,
            required: true,
            trim: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 0
        },
        unit: {
            type: String,
            required: true,
            trim: true
        },
        cost: {
            type: Number,
            min: 0,
            default: 0
        }
    }],
    total_cost: {
        type: Number,
        min: 0,
        default: 0
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    escalated: {
        type: Boolean,
        default: false
    },
    escalation_reason: {
        type: String,
        trim: true,
        maxlength: [500, 'Escalation reason cannot exceed 500 characters']
    },
    escalated_at: {
        type: Date,
        default: null
    },
    escalated_to: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Create compound indexes for efficient queries
taskSchema.index({ department: 1, status: 1, createdAt: -1 });
taskSchema.index({ assigned_to: 1, status: 1 });
taskSchema.index({ status: 1, priority: 1, createdAt: -1 });

// Virtual for task duration
taskSchema.virtual('duration_hours').get(function() {
    if (this.actual_completion && this.createdAt) {
        return Math.round((this.actual_completion - this.createdAt) / (1000 * 60 * 60));
    }
    return null;
});

// Virtual for time since assigned
taskSchema.virtual('time_since_assigned').get(function() {
    return Math.round((Date.now() - this.createdAt) / (1000 * 60 * 60));
});

// Virtual for overdue status
taskSchema.virtual('is_overdue').get(function() {
    if (this.estimated_completion && this.status !== 'completed' && this.status !== 'resolved') {
        return Date.now() > this.estimated_completion;
    }
    return false;
});

// Pre-save middleware for status changes
taskSchema.pre('save', function(next) {
    if (this.isModified('status')) {
        if ((this.status === 'completed' || this.status === 'resolved') && !this.actual_completion) {
            this.actual_completion = new Date();
        }
        
        // Add automatic work update when status changes
        if (this.isModified('status')) {
            const statusUpdate = {
                update: `Status changed to ${this.status}`,
                updated_by: this.assigned_to || this.created_by,
                status_change: {
                    from: this.constructor.findOne({ _id: this._id }).status,
                    to: this.status
                }
            };
            this.work_updates.push(statusUpdate);
        }
    }
    next();
});

// Static method to get department statistics
taskSchema.statics.getDepartmentStats = function() {
    return this.aggregate([
        {
            $group: {
                _id: {
                    department: '$department',
                    status: '$status'
                },
                count: { $sum: 1 },
                avgCost: { $avg: '$total_cost' }
            }
        },
        {
            $group: {
                _id: '$_id.department',
                statuses: {
                    $push: {
                        status: '$_id.status',
                        count: '$count',
                        avgCost: '$avgCost'
                    }
                },
                total: { $sum: '$count' }
            }
        }
    ]);
};

// Static method to get overdue tasks
taskSchema.statics.getOverdueTasks = function() {
    return this.find({
        estimated_completion: { $lt: new Date() },
        status: { $nin: ['completed', 'resolved'] }
    }).populate('report_id assigned_to');
};

// Static method to get workload by user
taskSchema.statics.getUserWorkload = function(userId) {
    return this.aggregate([
        { $match: { assigned_to: mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 }
            }
        }
    ]);
};

module.exports = mongoose.model('Task', taskSchema);