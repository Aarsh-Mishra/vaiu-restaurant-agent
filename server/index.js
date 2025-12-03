import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Booking from './models/booking.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
// Initialize environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(process.env.MONGO).then(()=>{
    console.log('Connected to MongoDB!');
}).catch((err)=>{
    console.log(err);
})

// --- 2. AI Configuration ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const PORT = process.env.PORT || 5000;

// (We mock this first to ensure logic works. Later we can connect a real API)
const getWeather = async (date) => {
  const forecasts = ['sunny', 'rainy', 'cloudy', 'clear', 'stormy'];
  const randomCondition = forecasts[Math.floor(Math.random() * forecasts.length)];
  return { condition: randomCondition, temp: 24 };
};

// --- 4. The "Brain" Route (AI Chat) ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log("User said:", message);

    // Prompt Engineering: Instruct Gemini to extract data
    const systemPrompt = `
    You are a helpful restaurant booking assistant for "Vaiu Bistro".
    Today's date is ${new Date().toISOString().split('T')[0]}.
    
    Your goal is to collect: Name, Date, Time, Guests, Cuisine Preference, and Seating Preference.
    
    Analyze the user's latest message: "${message}"
    
    Return a JSON object ONLY. NO markdown formatting. Structure:
    {
      "reply": "Your conversational response here. If you have the date, mention the weather.",
      "bookingDetails": {
        "name": "extracted name or null",
        "date": "extracted date (YYYY-MM-DD) or null",
        "time": "extracted time (24h format) or null",
        "guests": "extracted number or null",
        "cuisine": "extracted cuisine or null",
        "seating": "extracted seating (Indoor/Outdoor) or null"
      },
      "missingFields": ["list", "of", "fields", "still", "needed"],
      "intent": "booking_request" or "cancellation" or "general_inquiry"
    }
    `;

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    let text = response.text();
    
    // Clean up if Gemini adds markdown code blocks
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const aiData = JSON.parse(text);

    // Weather Integration Logic
    if (aiData.bookingDetails.date) {
        const weather = await getWeather(aiData.bookingDetails.date);
        
        // If the AI didn't already mention weather, add a tip
        if (!aiData.reply.toLowerCase().includes('weather')) {
             aiData.reply += ` By the way, the forecast for that day is ${weather.condition}.`;
        }
        
        // Suggest seating based on weather
        if (weather.condition === 'rainy' && !aiData.bookingDetails.seating) {
             aiData.reply += " Since it looks like rain, I'd recommend indoor seating.";
             aiData.bookingDetails.seating = "Indoor";
        } else if (weather.condition === 'sunny' && !aiData.bookingDetails.seating) {
             aiData.reply += " It's going to be sunny, so outdoor seating would be lovely!";
        }
    }

    res.json(aiData);

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

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