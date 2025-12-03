import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [messages, setMessages] = useState([
    { sender: 'bot', text: "Hello! I am the Vaiu Bistro Assistant. I can help you book a table. What date and time would you like?" }
  ]);
  const [isListening, setIsListening] = useState(false);
  const [bookingDetails, setBookingDetails] = useState({});
  const [status, setStatus] = useState('idle'); // idle, processing, speaking
  
  // Ref for auto-scrolling to bottom of chat
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- 1. Text-to-Speech Function ---
  const speak = (text) => {
    if (!window.speechSynthesis) return;
    
    // Stop any previous speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    
    window.speechSynthesis.speak(utterance);
  };

  // --- 2. Speech-to-Text Function ---
  const startListening = () => {
    // Check browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support voice recognition. Try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setStatus('listening');
    };

    recognition.onend = () => {
      setIsListening(false);
      if (status === 'listening') setStatus('idle');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      console.log("User said:", transcript);
      handleSendMessage(transcript);
    };

    recognition.start();
  };

  // --- 3. Handle Conversation Loop ---
  const handleSendMessage = async (userText) => {
    if (!userText.trim()) return;

    // Add User Message to UI
    const newMessages = [...messages, { sender: 'user', text: userText }];
    setMessages(newMessages);
    setStatus('processing');

    try {
      // CHANGE HERE: Send 'history' along with the 'message'
      const response = await axios.post('http://localhost:5000/api/chat', {
        message: userText,
        history: newMessages // We send the whole conversation so far
      });

      const aiData = response.data;
      const botReply = aiData.reply;

      // Update Booking Details state
      setBookingDetails(aiData.bookingDetails || {});

      // Add Bot Message to UI
      setMessages(prev => [...prev, { sender: 'bot', text: botReply }]);
      
      // Speak the response
      speak(botReply);

      // Check if ready to confirm (Simple logic: if all fields are mostly there)
      // Realistically, you'd check aiData.missingFields.length === 0
      if (aiData.intent === 'confirmation_request') {
         // You could trigger a specific UI action here
      }

    } catch (error) {
      console.error("Error talking to backend:", error);
      const errorMsg = "Sorry, I had trouble connecting to the server.";
      setMessages(prev => [...prev, { sender: 'bot', text: errorMsg }]);
      speak(errorMsg);
      setStatus('idle');
    }
  };

  // --- 4. Final Confirm Button Logic ---
  const handleConfirmBooking = async () => {
    try {
        const payload = {
            customerName: bookingDetails.name || "Guest",
            numberOfGuests: bookingDetails.guests || 2,
            bookingDate: bookingDetails.date || new Date(),
            bookingTime: bookingDetails.time || "19:00",
            specialRequests: bookingDetails.cuisine || "None",
            status: "Confirmed"
        };
        
        const res = await axios.post('http://localhost:5000/api/bookings', payload);
        alert(`Booking Confirmed! ID: ${res.data.booking._id}`);
        setMessages(prev => [...prev, { sender: 'bot', text: "Your booking has been officially saved to the database!" }]);
        speak("Your booking has been officially saved to the database!");
    } catch (err) {
        alert("Failed to save booking");
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>🍽️ Vaiu Bistro Voice Agent</h1>
      </header>

      <div className="main-content">
        {/* Left: Booking Status Card */}
        <div className="booking-card">
          <h2>Current Details</h2>
          <div className="detail-row"><strong>Name:</strong> {bookingDetails.name || '-'}</div>
          <div className="detail-row"><strong>Date:</strong> {bookingDetails.date || '-'}</div>
          <div className="detail-row"><strong>Time:</strong> {bookingDetails.time || '-'}</div>
          <div className="detail-row"><strong>Guests:</strong> {bookingDetails.guests || '-'}</div>
          <div className="detail-row"><strong>Seating:</strong> {bookingDetails.seating || '-'}</div>
          
          {/* Show confirm button only if we have minimum details */}
          {bookingDetails.date && bookingDetails.guests && (
             <button className="confirm-btn" onClick={handleConfirmBooking}>
               ✅ Confirm & Save
             </button>
          )}
        </div>

        {/* Right: Chat Interface */}
        <div className="chat-container">
          <div className="messages-list">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.sender}`}>
                {msg.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="controls">
             <button 
               className={`mic-button ${isListening ? 'active' : ''}`}
               onClick={startListening}
               disabled={status === 'processing' || status === 'speaking'}
             >
               {isListening ? 'Listening...' : '🎙️ Tap to Speak'}
             </button>
             <div className="status-text">Status: {status}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
