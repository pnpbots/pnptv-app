-- Add efipay to the payments_provider_valid constraint (easybots.store reseller)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_valid;
ALTER TABLE payments ADD CONSTRAINT payments_provider_valid CHECK (
  provider IS NULL OR provider = ANY(ARRAY[
    'epayco','daimo','paypal','stripe','manual','btcpay','dash','nowpayments','efipay'
  ])
);
