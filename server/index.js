import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Booking from './models/booking.js';
// Initialize environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
dotenv.config();

mongoose.connect(process.env.MONGO).then(()=>{
    console.log('Connected to MongoDB!');
}).catch((err)=>{
    console.log(err);
})


const PORT = process.env.PORT || 5000;

app.post('/api/bookings', async (req, res) => {
  try {
    const bookingData = req.body;
    
    // Create a new document using your Mongoose model
    const newBooking = new Booking(bookingData);
    
    // Save it to the database
    await newBooking.save();
    
    console.log("New booking saved:", newBooking);
    res.status(201).json({ message: "Booking confirmed!", booking: newBooking });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// 2. Get All Bookings (GET)
app.get('/api/bookings', async (req, res) => {
  try {
    // Fetch all documents from the bookings collection, sorted by newest first
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// Basic Health Check Route
app.get('/', (req, res) => {
  res.send('Server is running with ES Modules!');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});