const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [
            /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
            'Please enter a valid email'
        ]
    },
    mobile: {
        type: String,
        required: true,
        unique: true,
        match: [/^[0-9]{10}$/, 'Mobile number must be 10 digits']
    },
    password: {
        type: String,
        required: true,
        minlength: 6,
        select: false // Don't include password in queries by default
    },
    role: {
        type: String,
        enum: ['citizen', 'admin', 'field_worker', 'department_head', 'super_admin'],
        default: 'citizen'
    },
    department: {
        type: String,
        enum: [
            'Sanitation',
            'Public Works', 
            'Electrical',
            'Water & Sewerage',
            'Parks & Gardens',
            'General Services'
        ],
        required: function() {
            return this.role === 'field_worker' || this.role === 'department_head';
        }
    },
    employee_id: {
        type: String,
        unique: true,
        sparse: true, // Allow null values but ensure uniqueness when present
        required: function() {
            return this.role !== 'citizen';
        }
    },
    avatar: {
        type: String,
        default: null
    },
    address: {
        street: String,
        city: String,
        state: String,
        pincode: {
            type: String,
            match: [/^[0-9]{6}$/, 'Pincode must be 6 digits']
        }
    },
    preferences: {
        notifications: {
            email: { type: Boolean, default: true },
            sms: { type: Boolean, default: true },
            push: { type: Boolean, default: true }
        },
        language: {
            type: String,
            enum: ['en', 'hi', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'or'],
            default: 'en'
        }
    },
    verification: {
        email_verified: {
            type: Boolean,
            default: false
        },
        mobile_verified: {
            type: Boolean,
            default: false
        },
        identity_verified: {
            type: Boolean,
            default: false
        },
        email_verification_token: String,
        mobile_verification_otp: String,
        otp_expires: Date
    },
    activity: {
        last_login: {
            type: Date,
            default: null
        },
        login_count: {
            type: Number,
            default: 0
        },
        last_active: {
            type: Date,
            default: Date.now
        },
        failed_login_attempts: {
            type: Number,
            default: 0
        },
        account_locked: {
            type: Boolean,
            default: false
        },
        locked_until: Date
    },
    stats: {
        reports_submitted: {
            type: Number,
            default: 0
        },
        tasks_completed: {
            type: Number,
            default: 0
        },
        avg_rating: {
            type: Number,
            min: 0,
            max: 5,
            default: 0
        },
        total_ratings: {
            type: Number,
            default: 0
        }
    },
    device_tokens: [{
        token: String,
        platform: {
            type: String,
            enum: ['android', 'ios', 'web']
        },
        created_at: {
            type: Date,
            default: Date.now
        }
    }],
    status: {
        type: String,
        enum: ['active', 'inactive', 'suspended', 'pending'],
        default: 'pending'
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    password_reset: {
        token: String,
        expires: Date,
        used: {
            type: Boolean,
            default: false
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Create indexes
userSchema.index({ email: 1, mobile: 1 });
userSchema.index({ role: 1, department: 1 });

// Virtual for full name
userSchema.virtual('full_name').get(function() {
    return this.name;
});

// Virtual for account age
userSchema.virtual('account_age_days').get(function() {
    return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Virtual for display role
userSchema.virtual('display_role').get(function() {
    const roleMap = {
        'citizen': 'Citizen',
        'admin': 'Administrator',
        'field_worker': 'Field Worker',
        'department_head': 'Department Head',
        'super_admin': 'Super Administrator'
    };
    return roleMap[this.role] || this.role;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) return next();
    
    try {
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Pre-save middleware to generate employee_id
userSchema.pre('save', function(next) {
    if (!this.employee_id && this.role !== 'citizen') {
        const dept_codes = {
            'Sanitation': 'SAN',
            'Public Works': 'PWD',
            'Electrical': 'ELE',
            'Water & Sewerage': 'WSS',
            'Parks & Gardens': 'PNG',
            'General Services': 'GSV'
        };
        const dept_code = dept_codes[this.department] || 'GEN';
        this.employee_id = dept_code + '-' + Date.now().toString().slice(-6);
    }
    next();
});

// Method to check password
userSchema.methods.matchPassword = async function(enteredPassword) {
    const bcrypt = require('bcryptjs');
    return await bcrypt.compare(enteredPassword, this.password);
};

// Method to generate password reset token
userSchema.methods.getResetPasswordToken = function() {
    const crypto = require('crypto');
    const resetToken = crypto.randomBytes(20).toString('hex');
    
    // Hash and set to resetPasswordToken field
    this.password_reset.token = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    // Set expire time (10 minutes)
    this.password_reset.expires = Date.now() + 10 * 60 * 1000;
    this.password_reset.used = false;
    
    return resetToken;
};

// Method to check if account is locked
userSchema.methods.isLocked = function() {
    return !!(this.activity.account_locked && this.activity.locked_until && this.activity.locked_until > Date.now());
};

// Method to increment failed login attempts
userSchema.methods.incLoginAttempts = function() {
    // If we have a previous lock that has expired, restart at 1
    if (this.activity.locked_until && this.activity.locked_until < Date.now()) {
        return this.updateOne({
            $unset: {
                'activity.locked_until': 1,
                'activity.account_locked': 1
            },
            $set: {
                'activity.failed_login_attempts': 1
            }
        });
    }
    
    const updates = { $inc: { 'activity.failed_login_attempts': 1 } };
    
    // Lock account after 5 failed attempts for 2 hours
    if (this.activity.failed_login_attempts + 1 >= 5 && !this.isLocked()) {
        updates.$set = {
            'activity.account_locked': true,
            'activity.locked_until': Date.now() + 2 * 60 * 60 * 1000 // 2 hours
        };
    }
    
    return this.updateOne(updates);
};

// Method to reset login attempts on successful login
userSchema.methods.resetLoginAttempts = function() {
    return this.updateOne({
        $unset: {
            'activity.failed_login_attempts': 1,
            'activity.locked_until': 1,
            'activity.account_locked': 1
        },
        $set: {
            'activity.last_login': Date.now(),
            'activity.last_active': Date.now()
        },
        $inc: {
            'activity.login_count': 1
        }
    });
};

// Static method to get user statistics
userSchema.statics.getUserStats = function() {
    return this.aggregate([
        {
            $group: {
                _id: '$role',
                count: { $sum: 1 },
                active: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                    }
                }
            }
        }
    ]);
};

module.exports = mongoose.model('User', userSchema);