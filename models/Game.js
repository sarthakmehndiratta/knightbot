const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  player1: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  player2: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  fen: {
    type: String,
    default: 'startpos',
  },
  gameInProgress: {
    type: Boolean,
    default: true,
  },
  result: {
    type: String,
    default: null,
  },
  currentTurn:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,},
}, { timestamps: true });

const Game = mongoose.model('Game', gameSchema);

module.exports = Game;
