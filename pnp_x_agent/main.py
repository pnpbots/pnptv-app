import os
import pytz
import psycopg2
import urllib.parse
from psycopg2.extras import RealDictCursor
from apscheduler.schedulers.blocking import BlockingScheduler
from grok_client import GrokCognitiveEngine
from x_api_manager import XMultiAccountManager
from dotenv import load_dotenv

# Force reload of environment
load_dotenv(override=True)

def get_db_conn():
    db_url = os.getenv("DATABASE_URL")
    print(f"--- V2 ROBUST STARTING (v2.1) ---")
    
    if not db_url:
        return psycopg2.connect(
            dbname='pnptvbot', user='pnptvbot', password='Apelo801050#', 
            host='172.20.0.2', port='5432', cursor_factory=RealDictCursor
        )
    
    try:
        # Robust parsing for postgresql://user:pass@host:port/dbname
        # handles special characters like # in password by using rsplit
        if "://" in db_url:
            protocol, rest = db_url.split("://", 1)
            if "@" in rest:
                auth, connection = rest.rsplit("@", 1)
                user, password = auth.split(":", 1)
                password = urllib.parse.unquote(password)
                
                host_db = connection.split("/", 1)
                host_port = host_db[0]
                dbname = host_db[1] if len(host_db) > 1 else "postgres"
                
                if ":" in host_port:
                    host, port = host_port.split(":")
                else:
                    host = host_port
                    port = "5432"
                
                return psycopg2.connect(
                    dbname=dbname, user=user, password=password,
                    host=host, port=port, cursor_factory=RealDictCursor
                )
        
        return psycopg2.connect(db_url, cursor_factory=RealDictCursor)
    except Exception as e:
        print(f"V2 connection failed: {e}")
        raise

if __name__ == "__main__":
    print("Agent V2 Initializing...")
    try:
        conn = get_db_conn()
        print("V2 Database Connection SUCCESSFUL!")
        conn.close()
    except Exception as e:
        print(f"V2 Initialization FATAL: {e}")

    colombia_tz = pytz.timezone('America/Bogota')
    scheduler = BlockingScheduler(timezone=colombia_tz)
    
    # We can add jobs here later
    print("Agent V2 Ready and Waiting.")
    scheduler.start()
