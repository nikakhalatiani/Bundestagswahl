// npx ts-node src/runCalculateSeats.ts

const calculateSeats = require('./calculateSeats');

(async () => {
  try {
    const results = await calculateSeats(2025); // pass year if needed
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error running calculateSeats:', err);
    process.exit(1);
  }
})();