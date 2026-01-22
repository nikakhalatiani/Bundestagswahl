import argparse
import random
import time
import threading
import statistics
import sys
from urllib.parse import urljoin

# Try to import requests, fail gracefully if not installed
try:
    import requests
except ImportError:
    print("Error: The 'requests' module is required.")
    print("   Please install it using: pip install requests")
    sys.exit(1)

DEFAULT_BASE_URL = "http://localhost:4000"

QUERIES = [
    # Q1: Sitzverteilung (25%)
    {"name": "Q1", "weight": 0.25, "path": "/api/seats?year=2025"},
    
    # Q2: Abgeordnete (10%)
    {"name": "Q2", "weight": 0.10, "path": "/api/members?year=2025"},
    
    # Q3: Wahlkreisübersicht (25%)
    {"name": "Q3", "weight": 0.25, "path": "/api/constituency/{id}/overview?year=2025"},
    
    # Q4: Wahlkreissieger (10%)
    {"name": "Q4", "weight": 0.10, "path": "/api/constituency-winners?year=2025"},
    
    # Q5: Überhangmandate (10%)
    {"name": "Q5", "weight": 0.10, "path": "/api/direct-without-coverage?year=2025"},
    
    # Q6: Knappste Sieger (20%)
    {"name": "Q6", "weight": 0.20, "path": "/api/closest-winners?year=2025"},
]


class BenchmarkStats:
    def __init__(self):
        self.lock = threading.Lock()
        self.results = []
        self.errors = 0
        self.start_time = 0
        self.end_time = 0

    def start(self):
        self.start_time = time.time()

    def stop(self):
        self.end_time = time.time()

    def add_result(self, query_name, duration, status_code):
        with self.lock:
            self.results.append({
                "query": query_name,
                "duration": duration,
                "status": status_code,
                "timestamp": time.time()
            })
            if status_code < 200 or status_code >= 400:
                self.errors += 1

class Terminal(threading.Thread):
    """Emulates a browser/user (Terminal) interacting with the WIS."""
    def __init__(self, terminal_id, base_url, avg_wait_time, duration, stats):
        super().__init__()
        self.terminal_id = terminal_id
        self.base_url = base_url
        self.avg_wait_time = avg_wait_time
        self.duration = duration
        self.stats = stats
        self.stop_event = threading.Event()

    def get_random_constituency_id(self):
        # Returns a random constituency ID between 1 and 299
        return random.randint(1, 299)

    def run(self):
        start_run = time.time()
        
        # Pre-calculate weights for random selection
        query_opts = QUERIES
        weights = [q["weight"] for q in query_opts]
        
        while not self.stop_event.is_set():
            # Check if duration exceeded
            if time.time() - start_run > self.duration:
                break

            # 1. Pick Query based on probability distribution
            query_def = random.choices(query_opts, weights=weights, k=1)[0]
            
            # 2. Construct URL
            path = query_def["path"]
            if "{id}" in path:
                path = path.replace("{id}", str(self.get_random_constituency_id()))
            
            full_url = urljoin(self.base_url, path)

            # 3. Execute Request & Measure Duration
            req_start = time.time()
            status_code = 0
            try:
                response = requests.get(full_url, timeout=10)
                status_code = response.status_code
                # Ensure content is fully read
                _ = response.content
            except Exception as e:
                # Log error (simulated 599 status for client exception)
                status_code = 599
                if self.stats.errors < 3:
                    print(f"Request failed: {e}")
            
            req_end = time.time()
            duration = req_end - req_start
            
            self.stats.add_result(query_def["name"], duration, status_code)

            # 4. Wait (Think Time)
            # Uniform distribution [0.8 * t, 1.2 * t]
            wait_time = random.uniform(0.8 * self.avg_wait_time, 1.2 * self.avg_wait_time)
            self.stop_event.wait(wait_time)

def print_report(stats, args):
    total_time = stats.end_time - stats.start_time
    total_requests = len(stats.results)
    
    print("\n" + "="*60)
    print(f"WIS BENCHMARK REPORT")
    print("="*60)
    print(f"Configuration:")
    print(f"  Terminals (n): {args.terminals}")
    print(f"  Avg Wait (t):  {args.wait}s")
    print(f"  Duration:      {args.duration}s")
    print(f"  Base URL:      {args.url}")
    print("-" * 60)
    print(f"Results:")
    print(f"  Total Time:    {total_time:.2f} s")
    print(f"  Total Requests:{total_requests}")
    print(f"  Throughput:    {total_requests/total_time:.2f} req/s")
    print(f"  Errors:        {stats.errors}")
    print("-" * 60)
    
    # Group results by Query
    by_query = {q["name"]: [] for q in QUERIES}
    for r in stats.results:
        if r["query"] in by_query:
            by_query[r["query"]].append(r["duration"])

    print(f"{'Query':<8} {'Count':<8} {'Mix %':<8} {'Min(s)':<8} {'Avg(s)':<8} {'Max(s)':<8}")
    for q_def in QUERIES:
        name = q_def["name"]
        durations = by_query[name]
        count = len(durations)
        mix = (count / total_requests * 100) if total_requests > 0 else 0
        
        if count > 0:
            avg_d = statistics.mean(durations)
            min_d = min(durations)
            max_d = max(durations)
            print(f"{name:<8} {count:<8} {mix:<8.1f} {min_d:<8.3f} {avg_d:<8.3f} {max_d:<8.3f}")
        else:
            print(f"{name:<8} {0:<8} {0.0:<8.1f} {'-':<8} {'-':<8} {'-':<8}")
    print("="*60)

def main():
    parser = argparse.ArgumentParser(description="WIS Benchmark Client")
    parser.add_argument("-n", "--terminals", type=int, default=10, help="Number of terminals (emulated browsers)")
    parser.add_argument("-t", "--wait", type=float, default=1.0, help="Average wait time t in seconds")
    parser.add_argument("-d", "--duration", type=int, default=30, help="Benchmark duration in seconds")
    parser.add_argument("--url", type=str, default=DEFAULT_BASE_URL, help="Base URL of the WIS backend")
    
    args = parser.parse_args()
    
    random.seed(42)
    
    print(f"Starting Benchmark with {args.terminals} terminals...")
    
    stats = BenchmarkStats()
    terminals = []
    
    # Initialize terminals
    for i in range(args.terminals):
        t = Terminal(i, args.url, args.wait, args.duration, stats)
        terminals.append(t)
        
    # Start benchmark
    stats.start()
    for t in terminals:
        t.start()
        
    # Wait for completion
    try:
        for t in terminals:
            t.join()
    except KeyboardInterrupt:
        print("\nInterrupted! Stopping terminals...")
        for t in terminals:
            t.stop_event.set()
    
    stats.stop()
    print_report(stats, args)

if __name__ == "__main__":
    main()