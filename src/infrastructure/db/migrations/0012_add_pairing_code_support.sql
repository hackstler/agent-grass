ALTER TABLE whatsapp_sessions ADD COLUMN linking_method text NOT NULL DEFAULT 'qr';
ALTER TABLE whatsapp_sessions ADD COLUMN pairing_code text;
ALTER TABLE whatsapp_sessions ADD COLUMN phone_number text;
