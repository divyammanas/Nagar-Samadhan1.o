const Report = require('../models/Report');

class PriorityService {
    
    /**
     * Calculate smart priority for a new report based on clustering analysis
     * @param {Object} reportData - The new report data
     * @returns {String} Priority level (low, medium, high, urgent)
     */
    static async calculateSmartPriority(reportData) {
        const LOCATION_RADIUS_METERS = 2000; // 2km radius for location matching
        const TIME_WINDOW_HOURS = 168; // 7 days window for recent reports
        
        try {
            const timeWindowStart = new Date(Date.now() - (TIME_WINDOW_HOURS * 60 * 60 * 1000));
            
            // Find OTHER recent reports in the same category (excluding current report if it exists)
            const query = {
                category: reportData.category,
                createdAt: { $gte: timeWindowStart },
                status: { $ne: 'resolved' }
            };
            
            // Exclude current report if it has an ID (during recalculation)
            if (reportData._id) {
                query._id = { $ne: reportData._id };
            }
            
            const categoryMatches = await Report.find(query).countDocuments();
            
            let locationAndCategoryMatches = 0;
            
            // If we have coordinates, find nearby reports in same category
            if (reportData.location && reportData.location.coordinates && reportData.location.coordinates.coordinates) {
                const [longitude, latitude] = reportData.location.coordinates.coordinates;
                
                const geoQuery = {
                    category: reportData.category,
                    createdAt: { $gte: timeWindowStart },
                    status: { $ne: 'resolved' },
                    'location.coordinates': {
                        $geoWithin: {
                            $centerSphere: [[longitude, latitude], LOCATION_RADIUS_METERS / 6378100]
                        }
                    }
                };
                
                // Exclude current report if it has an ID
                if (reportData._id) {
                    geoQuery._id = { $ne: reportData._id };
                }
                
                locationAndCategoryMatches = await Report.find(geoQuery).countDocuments();
            } else if (reportData.location && reportData.location.city) {
                // Fallback to city-based matching if no GPS coordinates
                const cityQuery = {
                    category: reportData.category,
                    'location.city': { 
                        $regex: new RegExp(reportData.location.city.split(',')[0], 'i') 
                    },
                    createdAt: { $gte: timeWindowStart },
                    status: { $ne: 'resolved' }
                };
                
                // Exclude current report if it has an ID
                if (reportData._id) {
                    cityQuery._id = { $ne: reportData._id };
                }
                
                locationAndCategoryMatches = await Report.find(cityQuery).countDocuments();
                
                // Reduce the count since city matching is less precise
                locationAndCategoryMatches = Math.floor(locationAndCategoryMatches * 0.7);
            }
            
            // Priority logic based on clustering analysis
            let priority = 'low';
            
            // Get upvote count
            const upvoteCount = reportData.upvotes?.count || 0;
            
            let urgencyFactors = {
                similar_reports_count: categoryMatches,
                location_matches: locationAndCategoryMatches,
                category_matches: categoryMatches,
                upvote_count: upvoteCount,
                calculation_date: new Date()
            };
            
            // Location-based clustering takes priority (same location + same category)
            if (locationAndCategoryMatches >= 5) {
                priority = 'urgent';
            } else if (locationAndCategoryMatches >= 3) {
                priority = 'high';
            } else if (locationAndCategoryMatches >= 1) {
                priority = 'medium'; // 2+ reports in same area (including this one)
            } else if (categoryMatches >= 3) {
                priority = 'medium'; // 4+ reports in same category city-wide
            } else {
                priority = 'low'; // Individual report or small category cluster
            }
            
            // Apply upvote-based priority boost
            if (upvoteCount >= 25) {
                // 25+ upvotes = guaranteed high priority (community consensus)
                priority = 'high';
            } else if (upvoteCount >= 10) {
                // 10+ upvotes = boost priority by one level
                if (priority === 'low') {
                    priority = 'medium';
                } else if (priority === 'medium') {
                    priority = 'high';
                }
                // Don't downgrade urgent to high, keep urgent as highest
            } else if (upvoteCount >= 5) {
                // 5+ upvotes = minor boost for low priority reports
                if (priority === 'low') {
                    priority = 'medium';
                }
            }
            
            return { priority, urgencyFactors };
            
        } catch (error) {
            console.error('Error calculating smart priority:', error);
            return { 
                priority: 'low', 
                urgencyFactors: {
                    similar_reports_count: 0,
                    location_matches: 0,
                    category_matches: 0,
                    calculation_date: new Date()
                }
            };
        }
    }
    
    /**
     * Recalculate priorities for all pending reports
     * @returns {Object} Results of the recalculation
     */
    static async recalculateAllPriorities() {
        try {
            const pendingReports = await Report.find({ 
                status: { $in: ['pending', 'acknowledged', 'in_progress'] } 
            });
            
            const results = {
                updated: 0,
                errors: 0,
                priorities: { low: 0, medium: 0, high: 0, urgent: 0 }
            };
            
            for (let report of pendingReports) {
                try {
                    const { priority, urgencyFactors } = await this.calculateSmartPriority({
                        _id: report._id,
                        category: report.category,
                        location: report.location,
                        upvotes: report.upvotes
                    });
                    
                    if (report.priority !== priority) {
                        await Report.findByIdAndUpdate(report._id, {
                            priority: priority,
                            urgency_factors: urgencyFactors
                        });
                        results.updated++;
                    }
                    
                    results.priorities[priority]++;
                    
                } catch (error) {
                    console.error(`Error updating report ${report.public_id}:`, error);
                    results.errors++;
                }
            }
            
            return results;
            
        } catch (error) {
            console.error('Error in recalculateAllPriorities:', error);
            throw error;
        }
    }
    
    /**
     * Get priority distribution statistics
     * @returns {Object} Priority statistics
     */
    static async getPriorityStats() {
        try {
            const stats = await Report.aggregate([
                {
                    $group: {
                        _id: {
                            priority: '$priority',
                            status: '$status'
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: {
                        _id: '$_id.priority',
                        total: { $sum: '$count' },
                        statuses: {
                            $push: {
                                status: '$_id.status',
                                count: '$count'
                            }
                        }
                    }
                },
                {
                    $sort: { _id: 1 }
                }
            ]);
            
            return stats;
            
        } catch (error) {
            console.error('Error getting priority stats:', error);
            throw error;
        }
    }
    
    /**
     * Get reports that need urgent attention
     * @returns {Array} Array of urgent reports
     */
    static async getUrgentReports() {
        try {
            const urgentReports = await Report.find({
                priority: 'urgent',
                status: { $nin: ['resolved', 'rejected'] }
            })
            .populate('assigned_to', 'name employee_id department')
            .sort({ createdAt: -1 })
            .limit(50);
            
            return urgentReports;
            
        } catch (error) {
            console.error('Error getting urgent reports:', error);
            throw error;
        }
    }
    
    /**
     * Get priority trends over time
     * @param {Number} days - Number of days to analyze
     * @returns {Object} Trend data
     */
    static async getPriorityTrends(days = 30) {
        try {
            const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
            
            const trends = await Report.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            date: {
                                $dateToString: {
                                    format: '%Y-%m-%d',
                                    date: '$createdAt'
                                }
                            },
                            priority: '$priority'
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: {
                        _id: '$_id.date',
                        priorities: {
                            $push: {
                                priority: '$_id.priority',
                                count: '$count'
                            }
                        },
                        total: { $sum: '$count' }
                    }
                },
                {
                    $sort: { _id: 1 }
                }
            ]);
            
            return trends;
            
        } catch (error) {
            console.error('Error getting priority trends:', error);
            throw error;
        }
    }
    
    /**
     * Get location-based clustering analysis
     * @param {Number} radiusMeters - Radius for clustering analysis
     * @returns {Array} Clustering data
     */
    static async getLocationClusters(radiusMeters = 1000) {
        try {
            // This is a simplified clustering - for production, consider using proper clustering algorithms
            const reports = await Report.find({
                'location.coordinates': { $exists: true },
                status: { $nin: ['resolved', 'rejected'] }
            }).select('location priority category createdAt public_id');
            
            const clusters = [];
            const processed = new Set();
            
            for (let report of reports) {
                if (processed.has(report._id.toString())) continue;
                
                const [longitude, latitude] = report.location.coordinates.coordinates;
                
                // Find nearby reports
                const nearbyReports = await Report.find({
                    _id: { $ne: report._id },
                    'location.coordinates': {
                        $geoWithin: {
                            $centerSphere: [[longitude, latitude], radiusMeters / 6378100]
                        }
                    },
                    status: { $nin: ['resolved', 'rejected'] }
                }).select('location priority category createdAt public_id');
                
                if (nearbyReports.length > 0) {
                    clusters.push({
                        center: {
                            coordinates: [longitude, latitude],
                            city: report.location.city
                        },
                        reports: [report, ...nearbyReports],
                        count: nearbyReports.length + 1,
                        categories: [...new Set([report.category, ...nearbyReports.map(r => r.category)])],
                        highest_priority: this.getHighestPriority([report.priority, ...nearbyReports.map(r => r.priority)])
                    });
                    
                    // Mark all reports in this cluster as processed
                    processed.add(report._id.toString());
                    nearbyReports.forEach(r => processed.add(r._id.toString()));
                }
            }
            
            return clusters.sort((a, b) => b.count - a.count);
            
        } catch (error) {
            console.error('Error getting location clusters:', error);
            throw error;
        }
    }
    
    /**
     * Helper method to determine highest priority from an array
     * @param {Array} priorities - Array of priority strings
     * @returns {String} Highest priority
     */
    static getHighestPriority(priorities) {
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        return priorities.reduce((highest, current) => {
            return (priorityOrder[current] || 0) > (priorityOrder[highest] || 0) ? current : highest;
        }, 'low');
    }
}

module.exports = PriorityService;