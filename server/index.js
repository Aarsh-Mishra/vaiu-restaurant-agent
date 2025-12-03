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
    const { message, history } = req.body;
    console.log("User said:", message);

    // --- 1. Construct Context from History ---
    let conversationContext = "";
    if (history && history.length > 0) {
        conversationContext = history.map(msg => {
            const role = msg.sender === 'user' ? "User" : "Agent";
            return `${role}: ${msg.text}`;
        }).join("\n");
    }

    // --- 2. Improved System Prompt ---
    const systemPrompt = `
    You are a helpful restaurant booking assistant for "Vaiu Bistro".
    Today's date is ${new Date().toISOString().split('T')[0]}.
    
    HISTORY:
    ${conversationContext}
    
    CURRENT USER MESSAGE: "${message}"
    
    YOUR GOAL:
    You must collect ALL of the following information. Do not confirm the booking until you have them all:
    1. Name
    2. Date & Time
    3. Number of Guests
    4. Seating Preference (Indoor/Outdoor)
    5. Cuisine Preference (e.g., Italian, Chinese, or "Any")
    6. Special Requests (e.g., Birthday, Allergies, or "None")

    INSTRUCTIONS:
    - Compare HISTORY and CURRENT MESSAGE to find these details.
    - If any detail is missing, ASK the user for it politely.
    - Do not ask for details already provided.
    - Only set "intent" to "confirmation_request" when ALL fields are collected.
    
    Return JSON ONLY:
    {
      "reply": "Your response asking for missing details or confirming and don't repeat details already given.",

      "bookingDetails": {
        "name": "extracted or null",
        "date": "extracted (YYYY-MM-DD) or null",
        "time": "extracted or null",
        "guests": "extracted or null",
        "seating": "extracted or null",
        "cuisine": "extracted or null",
        "specialRequests": "extracted or null"
      },
      "intent": "booking_request" or "confirmation_request"
    }
    `;

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    let text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const aiData = JSON.parse(text);

    // --- 3. Smart Weather Logic (Fix Repetition) ---
    if (aiData.bookingDetails.date) {
        // Check if we already told the user the weather recently
        const lastBotMessage = history?.filter(msg => msg.sender === 'bot').pop();
        const weatherAlreadyDiscussed = lastBotMessage?.text.toLowerCase().includes('forecast');
        
        // Only fetch/append weather if it's NOT in the last bot message
        if (!weatherAlreadyDiscussed) {
             const weather = await getWeather(aiData.bookingDetails.date);
             // Append only if the AI didn't naturally include it in "reply"
             if (!aiData.reply.toLowerCase().includes('weather') && !aiData.reply.toLowerCase().includes('forecast')) {
                 aiData.reply += ` By the way, the forecast for that day is ${weather.condition}.`;
                 
                 // Add seating advice only if not already set
                 if (weather.condition.includes('rain') && !aiData.bookingDetails.seating) {
                     aiData.reply += " I recommend indoor seating.";
                 }
             }
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