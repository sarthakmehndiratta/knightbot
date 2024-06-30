const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  discordId: { type: String, required: true, unique: true },
  lichessUsername: { type: String, required: true },
  verificationCode: { type: String, required: true },
  verified: { type: Boolean, default: false },
  rating: { type: Number, default: 1200 }, 
});

module.exports = mongoose.model('User', userSchema);
