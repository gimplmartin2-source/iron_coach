# Simple script to fetch and parse the SQLite database
import urllib.request
import sqlite3
import json

URL = "https://drive.usercontent.google.com/download?id=1Zk1CUxCc0RjFpBy-Q28xvWML5NPn_HTR&export=download"

def fetch_and_parse():
    # Download
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
    
    with urllib.request.urlopen(req) as response:
        data = response.read()
        print(f"Downloaded {len(data)} bytes")
        
        # Save temp
        with open('temp.db', 'wb') as f:
            f.write(data)
    
    # Parse with sqlite3
    conn = sqlite3.connect('temp.db')
    cur = conn.cursor()
    
    # Get tables
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [t[0] for t in cur.fetchall()]
    print(f"Tables: {tables}")
    
    # Schema
    cur.execute("PRAGMA table_info(workouts)")
    columns = cur.fetchall()
    print(f"\n=== WORKOUTS SCHEMA ({len(columns)} columns) ===")
    for col in columns:
        print(f"  {col[0]}: {col[1]} ({col[2]}) - PK:{col[5]}")
    
    # Data
    cur.execute("SELECT * FROM workouts")
    rows = cur.fetchall()
    print(f"\n=== WORKOUTS DATA ({len(rows)} rows) ===")
    
    col_names = [c[1] for c in columns]
    print("Row | " + " | ".join(col_names))
    print("-" * 150)
    
    for i, row in enumerate(rows, 1):
        print(f"{i}: | {' | '.join(str(v) for v in row)}")
    
    conn.close()

if __name__ == '__main__':
    fetch_and_parse()
