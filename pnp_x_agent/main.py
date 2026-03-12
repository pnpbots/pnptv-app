import os
import pytz
import psycopg2
from psycopg2.extras import RealDictCursor
from apscheduler.schedulers.blocking import BlockingScheduler
from orchestrator import CampaignOrchestrator
from grok_client import GrokCognitiveEngine
from x_api_manager import XMultiAccountManager
from dotenv import load_dotenv

# Use standard paths for .env if available
load_dotenv()

def run_nightlife_campaign():
    print("Initiating peak nightlife posting sequence...")
    orchestrator = CampaignOrchestrator()
    # Execute a scheduled post for the Santino persona at peak hours
    # We can fetch a topic or persona-specific prompt from the database here.
    orchestrator.execute_ab_test_post(
        persona="santino",
        topic_variant_a="Santino commanding a sub to bootybump using heavy Spanish slang",
        topic_variant_b="Santino commanding a sub using primarily English"
    )

def daily_10am_analytics_sync():
    print("Running 10:00 AM (Bogota) Analytics Sync & Evaluator Loop...")
    db_url = os.getenv("DATABASE_URL")
    orchestrator = CampaignOrchestrator()
    ai = GrokCognitiveEngine()

    try:
        conn = psycopg2.connect(db_url, cursor_factory=RealDictCursor)
        with conn.cursor() as cur:
            # Retrieve active A/B tests to evaluate
            cur.execute("SELECT test_id, persona, tweet_id_a, tweet_id_b FROM x_ab_tests WHERE status = 'active' LIMIT 10")
            active_tests = cur.fetchall()

            for test in active_tests:
                test_id = test['test_id']
                persona = test['persona']
                ids = [test['tweet_id_a'], test['tweet_id_b']]

                # Extract the private metrics needed for conversion tracking
                try:
                    metrics = orchestrator.x_api.fetch_non_public_metrics(persona, ids)
                    # Pass to the Evaluator Agent for self-optimization
                    report = ai.evaluate_ab_test(str(metrics))
                    print(f"=== DAILY FINDINGS REPORT (Test {test_id}) ===")
                    print(report)
                    print("=============================")

                    # Log the report back to the database or mark as completed
                    cur.execute(
                        "UPDATE x_ab_tests SET status = 'evaluated', report = %s WHERE test_id = %s",
                        (report, test_id)
                    )
                except Exception as e:
                    print(f"Error evaluating test {test_id}: {e}")
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error in daily analytics sync: {e}")

if __name__ == "__main__":
    # Ensure database table exists for A/B tests (first run)
    try:
        db_url = os.getenv("DATABASE_URL")
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS x_ab_tests (
                    test_id SERIAL PRIMARY KEY,
                    persona VARCHAR(50),
                    tweet_id_a VARCHAR(50),
                    tweet_id_b VARCHAR(50),
                    text_a TEXT,
                    text_b TEXT,
                    status VARCHAR(20) DEFAULT 'active',
                    report TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Warning: Initial DB check failed: {e}")

    # Lock schedule strictly to Colombia time
    colombia_tz = pytz.timezone('America/Bogota')
    scheduler = BlockingScheduler(timezone=colombia_tz)

    # Schedule the Daily Sync exactly at 10:00 AM Colombia time
    scheduler.add_job(daily_10am_analytics_sync, 'cron', hour=10, minute=0)

    # Schedule automated posting during the peak Bucaramanga nightlife hours (e.g., 2:00 AM)
    scheduler.add_job(run_nightlife_campaign, 'cron', hour=2, minute=0)

    print("Agentic X framework (Merged) initialized. Awaiting triggers in America/Bogota timezone...")
    scheduler.start()
