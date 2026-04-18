# 🏙️ Nagar Samadhan
Smart civic issue reporting platform — Smart India Hackathon 2025

## Project Structure
```
nagar-samadhan/
├── backend/
│   ├── config/
│   │   └── database.js        # MongoDB connection
│   ├── models/
│   │   ├── Report.js          # Report schema
│   │   ├── Task.js            # Task schema
│   │   └── User.js            # User schema
│   ├── services/
│   │   └── priorityService.js # Smart priority algorithm
│   ├── server.js              # Express server + all API routes
│   └── clear-database.js      # Utility to clear DB
├── public/                    # Frontend (served as static files)
│   ├── index.html             # Landing page
│   ├── citizen.html           # Citizen complaint portal
│   ├── admin.html             # Admin dashboard
│   ├── admin-login.html       # Admin login
│   ├── report.html            # Individual report view
│   ├── notifications-simple.js
│   ├── sw.js                  # Service worker (PWA)
│   ├── manifest.json          # PWA manifest
│   └── icons/                 # App icons
├── .env.example               # Environment variable template
├── .gitignore
└── package.json
```

## Setup

1. **Clone and install**
```bash
git clone https://github.com/divyammanas/Nagar-Samadhan.git
cd Nagar-Samadhan
npm install --legacy-peer-deps
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your MongoDB URI and credentials
```

3. **Run locally**
```bash
npm start
# Visit http://localhost:3000
```

## Deployment
- **Backend** → Render (start command: `node backend/server.js`)
- **Frontend** → Served by Express from `public/` folder

## Tech Stack
- **Backend**: Node.js, Express.js, MongoDB, Mongoose
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Storage**: MongoDB GridFS for media files
- **Auth**: bcrypt password hashing
