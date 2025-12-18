const calculateSeatsModule = require('./calculateSeats');

(async () => {
  try {
    const year = process.argv[2] ? parseInt(process.argv[2]) : 2025;
    console.log(`\n=== Running Seat Allocation for ${year} ===\n`);

    const results = await calculateSeatsModule(year);

    // Pretty print with section headers
    console.log('\n--- Party Summary ---');
    console.table(results.summary);

    console.log('\n--- Federal Distribution (Oberverteilung) ---');
    console.table(results.federalDistribution);

    console.log('\n--- State Distribution (Unterverteilung) ---');
    console.table(results.stateDistribution);

    console.log('\n--- Total Seats Allocated ---');
    console.log(results.seatAllocation.length);

    process.exit(0);
  } catch (err) {
    console.error('Error running calculateSeats:', err);
    process.exit(1);
  }
})();