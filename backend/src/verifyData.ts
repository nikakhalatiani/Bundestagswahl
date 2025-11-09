import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Database Statistics:\n');
  
  const stateCount = await prisma.state.count();
  console.log(`✓ States: ${stateCount}`);
  
  const partyCount = await prisma.party.count();
  console.log(`✓ Parties: ${partyCount}`);
  
  const constituencyCount = await prisma.constituency.count();
  console.log(`✓ Constituencies: ${constituencyCount}`);
  
  const candidateCount = await prisma.candidate.count();
  console.log(`✓ Candidates: ${candidateCount}`);
  
  const statePartyCount = await prisma.stateParty.count();
  console.log(`✓ State Party Results: ${statePartyCount}`);
  
  console.log('\n--- Sample Data ---\n');
  
  // Sample states
  const states = await prisma.state.findMany({ take: 3 });
  console.log('Sample States:');
  states.forEach(s => console.log(`  ${s.id}: ${s.name}`));
  
  // Sample parties
  const parties = await prisma.party.findMany({ take: 5, orderBy: { id: 'asc' } });
  console.log('\nSample Parties:');
  parties.forEach(p => console.log(`  ${p.shortName}: ${p.longName}`));
  
  // Sample candidates with party info
  const candidates = await prisma.candidate.findMany({
    take: 3,
    where: { partyShortName: { not: null } },
    include: { party: true, state: true }
  });
  console.log('\nSample Candidates:');
  candidates.forEach(c => 
    console.log(`  ${c.firstName} ${c.lastName} (${c.party?.shortName}) - ${c.state.name}`)
  );
  
  // Top parties by second votes
  const topParties = await prisma.stateParty.groupBy({
    by: ['partyShortName'],
    _sum: { secondVotes: true },
    orderBy: { _sum: { secondVotes: 'desc' } },
    take: 5
  });
  console.log('\nTop 5 Parties by Second Votes:');
  topParties.forEach(p => 
    console.log(`  ${p.partyShortName}: ${p._sum.secondVotes?.toLocaleString()} votes`)
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
