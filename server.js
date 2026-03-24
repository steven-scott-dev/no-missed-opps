const express = require("express");
const path = require("path");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 3000;

// ENV VARS
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  BUSINESS_OWNER_NUMBER,
} = process.env;

if (
  !TWILIO_ACCOUNT_SID ||
  !TWILIO_AUTH_TOKEN ||
  !TWILIO_PHONE_NUMBER ||
  !BUSINESS_OWNER_NUMBER
) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Twilio sends webhooks as application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Demo storage: resets when server restarts
const leads = [];

// Home
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Frontend lead log API
app.get("/api/leads", (req, res) => {
  res.json({
    success: true,
    total: leads.length,
    leads: leads.slice().reverse(),
  });
});

// Twilio voice webhook for forwarded missed/unanswered calls
app.post("/voice", async (req, res) => {
  const callerNumber = req.body.From || "Unknown";
  const calledTwilioNumber = req.body.To || TWILIO_PHONE_NUMBER;
  const callSid = req.body.CallSid || "";
  const timestamp = new Date().toISOString();

  const lead = {
    id: callSid || String(Date.now()),
    callerNumber,
    calledTwilioNumber,
    timestamp,
    source: "forwarded_missed_call",
    customerSmsStatus: "pending",
    ownerSmsStatus: "pending",
  };

  leads.push(lead);

  // Send SMS to caller
  try {
    await client.messages.create({
      body: "Sorry we missed your call — were you looking to book an estimate or did you have a question?",
      from: TWILIO_PHONE_NUMBER,
      to: callerNumber,
    });
    lead.customerSmsStatus = "sent";
  } catch (err) {
    lead.customerSmsStatus = "failed";
    lead.customerSmsError = err.message;
    console.error("Caller SMS failed:", err.message);
  }

  // Send SMS to business owner
  try {
    await client.messages.create({
      body:
        `Missed Call Lead\n` +
        `Caller: ${callerNumber}\n` +
        `Time: ${new Date(timestamp).toLocaleString()}\n` +
        `CallSid: ${callSid || "N/A"}`,
      from: TWILIO_PHONE_NUMBER,
      to: BUSINESS_OWNER_NUMBER,
    });
    lead.ownerSmsStatus = "sent";
  } catch (err) {
    lead.ownerSmsStatus = "failed";
    lead.ownerSmsError = err.message;
    console.error("Owner SMS failed:", err.message);
  }

  // Return TwiML response to end the forwarded call
  // Twilio voice webhooks expect TwiML instructions. :contentReference[oaicite:1]{index=1}
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say("Sorry we missed your call. We are sending you a text message now.");
  twiml.hangup();

  res.type("text/xml");
  res.send(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
