import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Booking from './models/booking.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
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
  try {
    // You can hardcode a city like 'Mumbai' or 'New York' for this assignment
    const city = 'Trichy'; 
    const apiKey = process.env.OPENWEATHER_API_KEY; // Add this to your .env
    
    // Using OpenWeatherMap's 5-day forecast endpoint
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric`;
    
    const response = await axios.get(url);
    
    // Simple logic: Find the forecast closest to the booking date/time
    // (For simplicity, we just grab the first forecast item here, 
    // but in a real app, you'd filter response.data.list by date)
    const forecast = response.data.list[0];
    
    return {
      condition: forecast.weather[0].description,
      temp: forecast.main.temp
    };
  } catch (error) {
    console.error("Weather API Error:", error.message);
    return { condition: "unknown", temp: 25 }; // Fallback if API fails
  }
};

// --- 4. The "Brain" Route (AI Chat) ---
app.post('/api/chat', async (req, res) => {
  try {
    // 1. Get history from the frontend
    const { message, history } = req.body; 
    console.log("User said:", message);

    // 2. Format history into a conversation string for Gemini
    // We filter out the very first "Hello" message to save tokens if needed
    // format: "User: hello\nBot: hi there\nUser: ..."
    let conversationContext = "";
    
    if (history && history.length > 0) {
        conversationContext = history.map(msg => {
            const role = msg.sender === 'user' ? "User" : "Agent";
            return `${role}: ${msg.text}`;
        }).join("\n");
    }

    // 3. Updated System Prompt with Context
    const systemPrompt = `
    You are a helpful restaurant booking assistant for "Vaiu Bistro".
    Today's date is ${new Date().toISOString().split('T')[0]}.
    
    HISTORY OF CONVERSATION:
    ${conversationContext}
    
    CURRENT USER MESSAGE: "${message}"
    
    YOUR GOAL:
    Compare the "HISTORY" with the "CURRENT USER MESSAGE". 
    Extract the following details if they are mentioned anywhere in the conversation or the new message:
    - Name
    - Date (YYYY-MM-DD)
    - Time (24h format)
    - Number of Guests
    - Cuisine Preference (Default: Any)
    - Seating Preference (Indoor/Outdoor/Any)

    IMPORTANT: 
    - Do NOT ask for information that is already present in the HISTORY.
    - If the user provided "tomorrow", calculate the date based on today's date.
    - If the user says "2 tables", assume "Guests" is missing or ask "How many people per table?"
    
    Return a JSON object ONLY. NO markdown. Structure:
    {
      "reply": "Your natural response. Keep it brief. Only ask for missing fields.",
      "bookingDetails": {
        "name": "extracted or null",
        "date": "extracted or null",
        "time": "extracted or null",
        "guests": "extracted or null",
        "cuisine": "extracted or null",
        "seating": "extracted or null"
      },
      "intent": "booking_request" or "confirmation_request"
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

// Get Specific Booking (GET /:id)

app.get('/api/bookings/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    res.json(booking);
  } catch (error) {
    res.status(500).json({ error: "Error fetching booking" });
  }
});

// Cancel Booking

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const deletedBooking = await Booking.findByIdAndDelete(req.params.id);
    if (!deletedBooking) return res.status(404).json({ error: "Booking not found" });
    res.json({ message: "Booking cancelled successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error cancelling booking" });
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