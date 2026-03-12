import os
import tweepy

class XMultiAccountManager:
    def __init__(self, x_accounts=None):
        self.clients = {}
        
        # Priority 1: Use specific Consumer Keys per persona from ENV
        personas = ["generic", "santino", "lex"]
        for p in personas:
            ck = os.getenv(f"{p.upper()}_CONSUMER_KEY")
            cs = os.getenv(f"{p.upper()}_CONSUMER_SECRET")
            at = os.getenv(f"{p.upper()}_ACCESS_TOKEN")
            as_ = os.getenv(f"{p.upper()}_ACCESS_SECRET")
            
            if ck and cs and at and as_:
                self.clients[p] = tweepy.Client(
                    consumer_key=ck,
                    consumer_secret=cs,
                    access_token=at,
                    access_token_secret=as_
                )

        # Priority 2: Accounts from Database (if they use a unified App key)
        if x_accounts:
            # Fallback to a single global key if provided, or per-account keys
            global_ck = os.getenv("X_API_KEY")
            global_cs = os.getenv("X_API_SECRET")
            
            for acc in x_accounts:
                handle = acc['handle'].lower()
                if handle not in self.clients:
                    self.clients[handle] = tweepy.Client(
                        consumer_key=global_ck,
                        consumer_secret=global_cs,
                        access_token=acc['access_token'],
                        access_token_secret=acc['access_token_secret']
                    )

    def post_to_account(self, persona, text):
        client = self.clients.get(persona.lower())
        if client:
            response = client.create_tweet(text=text)
            return response.data['id']
        raise ValueError(f"Persona {persona} not found or credentials missing in .env.")

    def fetch_non_public_metrics(self, persona, tweet_ids):
        client = self.clients.get(persona.lower())
        if not client:
             raise ValueError(f"Persona {persona} not found.")

        response = client.get_tweets(
            tweet_ids,
            tweet_fields=["non_public_metrics", "public_metrics"]
        )
        metrics_data = []
        if not response.data:
            return metrics_data

        for tweet in response.data:
            npm = tweet.non_public_metrics or {}
            pm = tweet.public_metrics or {}
            metrics_data.append({
                "tweet_id": tweet.id,
                "impressions": npm.get("impression_count", 0),
                "profile_clicks": npm.get("user_profile_clicks", 0),
                "link_clicks": npm.get("url_link_clicks", 0),
                "likes": pm.get("like_count", 0),
                "retweets": pm.get("retweet_count", 0)
            })
        return metrics_data
