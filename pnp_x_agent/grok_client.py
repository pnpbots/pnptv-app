import os
from xai_sdk import Client

class GrokCognitiveEngine:
    def __init__(self):
        self.client = Client(api_key=os.getenv("XAI_API_KEY"))

    def generate_persona_post(self, system_rules, topic, model="grok-4-1-fast-reasoning"):
        # The system role must be the first message to enforce unfiltered subcultural rules
        messages = [
            {"role": "system", "content": system_rules},
            {"role": "user", "content": f"Generate an X post about: {topic}"}
        ]
        # We elevate the temperature slightly for the chaotic, raw tone required
        response = self.client.chat.create(
            model=model,
            messages=messages,
            temperature=0.95
        )
        return response.choices[0].message.content

    def evaluate_ab_test(self, analytics_data, model="grok-4.20-multi-agent-beta-0309"):
        # The evaluator agent processes JSON metrics to recommend strategy shifts
        messages = [
            {"role": "system", "content": "You are a social media analytics expert. Evaluate the following A/B test data and recommend the best strategy for PNPtv growth."},
            {"role": "user", "content": f"Analytics Data: {analytics_data}"}
        ]
        response = self.client.chat.create(
            model=model,
            messages=messages,
            temperature=0.2 # Low temperature for analytical precision
        )
        return response.choices[0].message.content
