import os
import psycopg2
from psycopg2.extras import RealDictCursor
from grok_client import GrokCognitiveEngine
from x_api_manager import XMultiAccountManager

import urllib.parse

def get_db_conn():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable is required")
    
    try:
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
        print(f"Connection failed: {e}")
        raise

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
            conn = get_db_conn()
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
        # Log A/B tests to the Node.js-managed x_ab_tests table
        try:
            conn = get_db_conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO x_ab_tests (campaign_id, variant_a, variant_b) VALUES (NULL, %s, %s)",
                    (id_a, id_b)
                )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error logging A/B test to DB: {e}")
