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

// Weather Mock
const getWeather = async (date) => {
  try {
    const city = 'Trichy'; 
    const apiKey = process.env.OPENWEATHER_API_KEY; 
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric`;
    const response = await axios.get(url);
    const forecast = response.data.list[0];
    return {
      condition: forecast.weather[0].description,
      temp: forecast.main.temp
    };
  } catch (error) {
    return { condition: "unknown", temp: 25 };
  }
};

// --- 4. The "Brain" Route (AI Chat) ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;

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
    Collect: Name, Date, Time, Guests, Seating (Indoor/Outdoor), Cuisine, Special Requests.

    LOGIC:
    1. Compare HISTORY and CURRENT MESSAGE to find details.
    2. If a detail is missing, ASK for it politely.
    3. If ALL details are present but user hasn't explicitly said "yes" or "confirm" to finalize, set intent to "confirmation_request".
    4. If ALL details are present AND the user says "yes", "confirm", "go ahead", or similar to finalize, set intent to "confirmed".
    
    Return JSON ONLY:
    {
      "reply": "Your conversational response.",
      "bookingDetails": {
        "name": "extracted or null",
        "date": "extracted (YYYY-MM-DD) or null",
        "time": "extracted or null",
        "guests": "extracted or null",
        "seating": "extracted or null",
        "cuisine": "extracted or null",
        "specialRequests": "extracted or null"
      },
      "intent": "booking_request" | "confirmation_request" | "confirmed"
    }
    `;

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    let text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const aiData = JSON.parse(text);

    // --- 3. Smart Weather Logic (Runs only once per session) ---
    if (aiData.bookingDetails.date) {
        // Check if bot has EVER mentioned weather or forecast in the history
        const weatherAlreadyDiscussed = history?.some(msg => 
            msg.sender === 'bot' && 
            (msg.text.toLowerCase().includes('forecast') || msg.text.toLowerCase().includes('weather'))
        );
        
        // Only run if date exists AND it hasn't been discussed yet
        if (!weatherAlreadyDiscussed) {
             const weather = await getWeather(aiData.bookingDetails.date);
             
             // Double check the AI didn't just generate a weather response right now
             if (!aiData.reply.toLowerCase().includes('weather') && !aiData.reply.toLowerCase().includes('forecast')) {
                 aiData.reply += ` By the way, the forecast is ${weather.condition}.`;
                 
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

// Create Booking
app.post('/api/bookings', async (req, res) => {
  try {
    const bookingData = req.body;
    const newBooking = new Booking(bookingData);
    await newBooking.save();
    res.status(201).json({ message: "Booking confirmed!", booking: newBooking });
  } catch (error) {
    res.status(500).json({ error: "Failed to create booking" });
  }
});

//Ql Booking
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// Get Specific Booking
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

app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});