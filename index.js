require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const axios = require('axios');
const { Chess } = require('chess.js');
const User = require('./models/User'); 
const Game = require('./models/Game'); 
const { calculateNewRatings } = require('./rating');


mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1); 
  });


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, 
  ],
});

const chess = new Chess();


async function fetchBoardImage(fen) {
  try {
    const response = await axios.get(`https://chessboardimage.com/${fen}.png`, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    console.error('Failed to fetch board image:', error);
    throw new Error('Failed to fetch board image');
  }
}



client.once('ready', () => {
  console.log('Bot is ready!');
});


function generateUniqueCode() {
  return Math.random().toString(36).substr(2, 6); 
}


client.on('messageCreate', async (message) => {
  if (!message.guild) return; 
  if (message.author.bot) return; 

  if (message.content.startsWith('!lichess')) {
    const username = message.content.split(' ')[1];
    console.log('!lichess command received from:', message.author.id);
    console.log('Username:', username);

    if (!username) {
      message.reply('Please provide a Lichess username.');
      console.error('No username provided.');
      return;
    }

    
    const uniqueCode = generateUniqueCode();

    
    try {
      const dmChannel = await message.author.createDM();
      await dmChannel.send(`To verify your Lichess account (${username}), please place this code "${uniqueCode}" in your Lichess bio.`);
      message.reply('Check your DM for the verification instructions.');
    } catch (error) {
      console.error('Failed to send DM:', error);
      message.reply('Failed to send verification instructions. Please enable DMs from server members and try again.');
      return;
    }

    
    try {
      let user = await User.findOne({ discordId: message.author.id });

      if (!user) {
        user = new User({
          discordId: message.author.id,
          lichessUsername: username,
          verificationCode: uniqueCode,
          verified: false, 
        });
      } else {
        user.lichessUsername = username;
        user.verificationCode = uniqueCode;
        user.verified = false; 
      }

      await user.save();
      console.log('User saved to MongoDB:', user);
    } catch (error) {
      console.error('Failed to save user:', error);
      message.reply('Failed to save user data. Please try again later.');
    }
  }
  if (message.content.startsWith('!play')) {
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      message.reply('Please mention a user to play with.');
      return;
    }

    try {
      
      let player1 = await User.findOne({ discordId: message.author.id });
      let player2 = await User.findOne({ discordId: mentionedUser.id });

      if (!player1 || !player2) {
        message.reply('One of the players is not registered. They need to set their lichess username using !lichess command.');
        return;
      }

      
      const ongoingGame = await Game.findOne({
        $or: [
          { player1: player1._id, gameInProgress: true },
          { player2: player1._id, gameInProgress: true },
          { player1: player2._id, gameInProgress: true },
          { player2: player2._id, gameInProgress: true },
        ],
      });

      if (ongoingGame) {
        message.reply('One of the players is already in an ongoing game.');
        return;
      }

      message.channel.send(`Game started between ${message.author.username} and ${mentionedUser.username}`);

      
      chess.reset();
      
      
      const newGame = new Game({
        player1: player1._id,
        player2: player2._id,
        fen: chess.fen(),
        gameInProgress: true,
        currentTurn: player1._id,
      });
      await newGame.save();

      
      try {
        const boardImageBuffer = await fetchBoardImage(chess.fen());
        
        
        message.channel.send({
          files: [{
            attachment: boardImageBuffer,
            name: 'chessboard.png'
          }]
        });
      } catch (error) {
        console.error('Failed to fetch the initial board image:', error);
        message.channel.send('Failed to fetch the initial board image.');
      }
    } catch (error) {
      console.error('Error finding players in MongoDB:', error);
      message.reply('Failed to start the game. Please try again later.');
    }
  }
  
  if (message.content.startsWith('!move')) {
    const move = message.content.split(' ')[1];
    if (!move) {
      message.reply('Please provide a move.');
      return;
    }

    const player = await User.findOne({ discordId: message.author.id });
    if (!player) {
      message.reply('You are not registered. Please set your Lichess username using !lichess command.');
      return;
    }

    const ongoingGame = await Game.findOne({
      $or: [{ player1: player._id }, { player2: player._id }],
      gameInProgress: true
    });

    if (!ongoingGame) {
      message.reply('No ongoing game found.');
      return;
    }

    if (ongoingGame.currentTurn.toString() !== player._id.toString()) {
      message.reply('It is not your turn to move.');
      return;
    }

    const result = chess.move(move, { sloppy: true });
    if (!result) {
      message.reply('Invalid move. Please try again.');
      return;
    }

    try {
      const boardImageBuffer = await fetchBoardImage(chess.fen());

      message.channel.send({
        files: [{
          attachment: boardImageBuffer,
          name: 'chessboard.png'
        }]
      });

      ongoingGame.fen = chess.fen();
      ongoingGame.currentTurn = (ongoingGame.currentTurn.toString() === ongoingGame.player1.toString())
        ? ongoingGame.player2
        : ongoingGame.player1;
      await ongoingGame.save();

      console.log(`Current FEN: ${chess.fen()}`);
      console.log(`Checkmate: ${chess.isCheckmate()}`);
      console.log(`Draw: ${chess.isDraw()}`);
      console.log(`Stalemate: ${chess.isStalemate()}`);
      console.log(`Threefold repetition: ${chess.isThreefoldRepetition()}`);
      console.log(`Insufficient material: ${chess.isInsufficientMaterial()}`);

      if (chess.isCheckmate() || chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
        ongoingGame.gameInProgress = false;
        await ongoingGame.save();

        if (chess.isCheckmate()) {
          const winner = chess.turn() === 'w' ? ongoingGame.player2 : ongoingGame.player1;
          const loser = chess.turn() === 'w' ? ongoingGame.player1 : ongoingGame.player2;

          const winnerUser = await User.findById(winner);
          const loserUser = await User.findById(loser);

          
          const { newWinnerRating, newLoserRating } = calculateNewRatings(winnerUser.rating, loserUser.rating);
          winnerUser.rating = newWinnerRating;
          loserUser.rating = newLoserRating;
          await winnerUser.save();
          await loserUser.save();

          message.channel.send(`Game over! ${winnerUser.lichessUsername} defeated ${loserUser.lichessUsername}. New ratings: ${winnerUser.lichessUsername} - ${winnerUser.rating}, ${loserUser.lichessUsername} - ${loserUser.rating}`);
        } else {
          message.channel.send('Game over! The game ended in a draw.');
        }
      }
    } catch (error) {
      console.error('Failed to fetch the board image after move:', error);
      message.reply('Failed to process the move. Please try again later.');
    }
  }
  
  if (message.content.startsWith('!resign')) {
    try {
      
      const resigningPlayer = await User.findOne({ discordId: message.author.id });
      const ongoingGame = await Game.findOne({
        $or: [
          { player1: resigningPlayer._id, gameInProgress: true },
          { player2: resigningPlayer._id, gameInProgress: true },
        ],
      });

      if (!ongoingGame) {
        message.reply('You are not currently in a game to resign.');
        return;
      }

      
      ongoingGame.gameInProgress = false;
      await ongoingGame.save();

      const winner = ongoingGame.player1.equals(resigningPlayer._id) ? ongoingGame.player2 : ongoingGame.player1;
      const winnerUser = await User.findById(winner);

      message.channel.send(`You have resigned from the game. ${winnerUser.lichessUsername} wins.`);
    } catch (error) {
      console.error('Error finding or updating game for resignation:', error);
      message.reply('Failed to resign from the game. Please try again later.');
    }
  }

  
  if (message.content.startsWith('!verify')) {
    try {
      
      const user = await User.findOne({ discordId: message.author.id });

      if (!user || !user.lichessUsername || !user.verificationCode) {
        message.reply('You need to set your Lichess username and receive a verification code first using !lichess <username>.');
        return;
      }

      
      const lichessProfile = await axios.get(`https://lichess.org/api/user/${user.lichessUsername}`);
      const lichessBio = lichessProfile.data.profile.bio || ''; 

      if (lichessBio.includes(user.verificationCode)) {
        user.verified = true; 
        await user.save();
        console.log('User verified:', user);
        message.reply('Your Lichess account has been successfully verified!');
      } else {
        message.reply('Verification code not found in your Lichess bio. Please update your bio and try again.');
      }
    } catch (error) {
      console.error('Error verifying Lichess account:', error);
      message.reply('Failed to verify Lichess account. Please try again later.');
    }
  }
  if (message.content.startsWith('!leaderboard')) {
    try {
      const topPlayers = await User.find().sort({ rating: -1 }).limit(10); 
  
      if (topPlayers.length === 0) {
        message.reply('No players found.');
        return;
      }
  
      let leaderboard = '🏆 **Top Players** 🏆\n\n';
      for (let index = 0; index < topPlayers.length; index++) {
        const player = topPlayers[index];
  
        
        let discordUser = client.users.cache.get(player.discordId);
        if (!discordUser) {
          
          try {
            discordUser = await client.users.fetch(player.discordId);
          } catch (error) {
            console.error('Failed to fetch Discord user:', error);
            leaderboard += `${index + 1}. *Unknown User* - ${player.rating} rating\n`;
            continue; 
          }
        }
  
        leaderboard += `${index + 1}. ${discordUser.username} - ${player.rating} \n`;
      }
  
      message.channel.send(leaderboard);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
      message.reply('Failed to fetch leaderboard. Please try again later.');
    }
    
  }
  if (message.content.startsWith('!blitz')) {
    const args = message.content.split(' ');
    if (args.length !== 2) {
      message.reply('Please mention a user using !blitz @username');
      return;
    }

    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      message.reply('Please mention a valid user.');
      return;
    }

    try {
      const user = await User.findOne({ discordId: mentionedUser.id });
      if (!user || !user.lichessUsername) {
        message.reply(`${mentionedUser.username} has not set their Lichess username.`);
        return;
      }

      const lichessProfile = await axios.get(`https://lichess.org/api/user/${user.lichessUsername}`);
      const blitzRating = lichessProfile.data.perfs.blitz.rating;

      message.channel.send(`${user.lichessUsername}'s Blitz rating: ${blitzRating}`);
    } catch (error) {
      console.error('Error fetching Blitz rating:', error);
      message.reply('Failed to fetch Blitz rating. Please try again later.');
    }
  }

  if (message.content.startsWith('!rapid')) {
    const args = message.content.split(' ');
    if (args.length !== 2) {
      message.reply('Please mention a user using !rapid @username');
      return;
    }

    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      message.reply('Please mention a valid user.');
      return;
    }

    try {
      const user = await User.findOne({ discordId: mentionedUser.id });
      if (!user || !user.lichessUsername) {
        message.reply(`${mentionedUser.username} has not set their Lichess username.`);
        return;
      }

      const lichessProfile = await axios.get(`https://lichess.org/api/user/${user.lichessUsername}`);
      const rapidRating = lichessProfile.data.perfs.rapid.rating;

      message.channel.send(`${user.lichessUsername}'s Rapid rating: ${rapidRating}`);
    } catch (error) {
      console.error('Error fetching Rapid rating:', error);
      message.reply('Failed to fetch Rapid rating. Please try again later.');
    }
  }

  if (message.content.startsWith('!bullet')) {
    const args = message.content.split(' ');
    if (args.length !== 2) {
      message.reply('Please mention a user using !bullet @username');
      return;
    }

    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      message.reply('Please mention a valid user.');
      return;
    }

    try {
      const user = await User.findOne({ discordId: mentionedUser.id });
      if (!user || !user.lichessUsername) {
        message.reply(`${mentionedUser.username} has not set their Lichess username.`);
        return;
      }

      const lichessProfile = await axios.get(`https://lichess.org/api/user/${user.lichessUsername}`);
      const bulletRating = lichessProfile.data.perfs.bullet.rating;

      message.channel.send(`${user.lichessUsername}'s Bullet rating: ${bulletRating}`);
    } catch (error) {
      console.error('Error fetching Bullet rating:', error);
      message.reply('Failed to fetch Bullet rating. Please try again later.');
    }
  }
  
  
});


client.on('presenceUpdate', async (oldPresence, newPresence) => {
  try {
    if (!newPresence.activities.length) return;

    
    const lichessActivity = newPresence.activities.find(activity => activity.type === 'CUSTOM_STATUS' && activity.name === 'Playing on Lichess.org');
    if (!lichessActivity) return;

    
    const user = await User.findOne({ discordId: newPresence.userId });

    if (!user || !user.lichessUsername || !user.verificationCode) return;

    
    const lichessProfile = await axios.get(`https://lichess.org/api/user/${user.lichessUsername}`);
    const lichessBio = lichessProfile.data.profile.bio || '';

    if (lichessBio.includes(user.verificationCode)) {
      user.verified = true; 
      await user.save();
      console.log('User verified:', user);
      const guild = await client.guilds.fetch(process.env.DISCORD_SERVER_ID);
      const member = await guild.members.fetch(user.discordId);
      member.send('Your Lichess account has been successfully verified!');
    }
  } catch (error) {
    console.error('Error in presenceUpdate event:', error);
  }
});


client.on('error', (error) => {
  console.error('Discord client encountered an error:', error);
});


client.on('warn', (warning) => {
  console.warn('Discord client encountered a warning:', warning);
});


client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('Successfully logged in to Discord');
  })
  .catch((error) => {
    console.error('Failed to log in to Discord:', error);
    process.exit(1); 
  });
