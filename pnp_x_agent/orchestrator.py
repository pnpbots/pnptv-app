import os
import psycopg2
from psycopg2.extras import RealDictCursor
from grok_client import GrokCognitiveEngine
from x_api_manager import XMultiAccountManager

class CampaignOrchestrator:
    def __init__(self):
        self.ai = GrokCognitiveEngine()
        self.db_url = os.getenv("DATABASE_URL")
        self.x_api = self._init_x_manager()

        # Load core memory identity prompts
        self.personas = {
            "santino": "You are Santino — the ultimate Latino PNP daddy from PNPtv. You are dominant, charismatic, and use heavy Spanish slang. Your posts are raw and authoritative.",
            "lex": "You are Lex — the ultimate spun boy/slut from PNPtv. You are expressive, wild, and always looking for clouds and slams. You talk about the deep, spun fire of PNP.",
            "generic": "You are an expert at writing authentic PnP-style posts that are subcultural, unfiltered, and drive high engagement for PNPtv.app."
        }

    def _init_x_manager(self):
        # Fetch active accounts from DB to initialize manager
        try:
            conn = psycopg2.connect(self.db_url, cursor_factory=RealDictCursor)
            with conn.cursor() as cur:
                cur.execute("SELECT handle, encrypted_access_token as access_token, encrypted_access_token as access_token_secret FROM x_accounts WHERE is_active = TRUE")
                # Note: encryption/decryption logic might be needed here if Node.js uses a custom key.
                # Assuming plaintext for now or that we need a decryption helper.
                accounts = cur.fetchall()
            conn.close()
            return XMultiAccountManager(accounts)
        except Exception as e:
            print(f"Error initializing X manager from DB: {e}")
            return XMultiAccountManager()

    def execute_ab_test_post(self, persona, topic_variant_a, topic_variant_b):
        # Generator Agent drafts variants
        system_rules = self.personas.get(persona.lower(), self.personas["generic"])
        post_a = self.ai.generate_persona_post(system_rules, topic_variant_a)
        post_b = self.ai.generate_persona_post(system_rules, topic_variant_b)

        # Post to the corresponding account
        id_a = self.x_api.post_to_account(persona, post_a)
        id_b = self.x_api.post_to_account(persona, post_b)

        # Log IDs locally to a database or file for the Evaluator Agent
        self._log_test_to_db(persona, id_a, id_b, post_a, post_b)
        print(f"A/B Test Deployed for {persona}. A:{id_a} B:{id_b}")

    def _log_test_to_db(self, persona, id_a, id_b, text_a, text_b):
        # We can reuse x_post_jobs table or a new one.
        # For simplicity in this 'merge', let's use x_post_jobs if possible or a dedicated tests table.
        try:
            conn = psycopg2.connect(self.db_url)
            with conn.cursor() as cur:
                # Assuming we want to track these as specific tests
                # If we don't have an ab_tests table, we just print for now or create it
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS x_ab_tests (
                        test_id SERIAL PRIMARY KEY,
                        persona VARCHAR(50),
                        tweet_id_a VARCHAR(50),
                        tweet_id_b VARCHAR(50),
                        text_a TEXT,
                        text_b TEXT,
                        status VARCHAR(20) DEFAULT 'active',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """)
                cur.execute(
                    "INSERT INTO x_ab_tests (persona, tweet_id_a, tweet_id_b, text_a, text_b) VALUES (%s, %s, %s, %s, %s)",
                    (persona, id_a, id_b, text_a, text_b)
                )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error logging A/B test to DB: {e}")
