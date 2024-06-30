
function calculateNewRatings(winnerRating, loserRating) {
    const k = 32; 
    const expectedWinnerScore = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
    const expectedLoserScore = 1 - expectedWinnerScore;
  
    const newWinnerRating = Math.round(winnerRating + k * (1 - expectedWinnerScore));
    const newLoserRating = Math.round(loserRating + k * (0 - expectedLoserScore));
  
    return { newWinnerRating, newLoserRating };
  }
  
  module.exports = { calculateNewRatings };
  