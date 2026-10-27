-- Finale C. Demo signing and a separate local witness; no claim of independent production custody.
CREATE TABLE approval_letters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),decision_id uuid NOT NULL UNIQUE REFERENCES decisions(id),application_id uuid NOT NULL REFERENCES applications(id),
 letter_no text NOT NULL UNIQUE,payload jsonb NOT NULL,signature text NOT NULL,key_id text NOT NULL,issued_at timestamptz NOT NULL,
 revoked_at timestamptz,revoke_reason text,CHECK((revoked_at IS NULL)=(revoke_reason IS NULL))
);
CREATE INDEX ON approval_letters(application_id);
CREATE FUNCTION letter_signed_fields_immutable() RETURNS trigger AS $$ BEGIN
 IF ROW(NEW.decision_id,NEW.application_id,NEW.letter_no,NEW.payload,NEW.signature,NEW.key_id,NEW.issued_at) IS DISTINCT FROM ROW(OLD.decision_id,OLD.application_id,OLD.letter_no,OLD.payload,OLD.signature,OLD.key_id,OLD.issued_at) THEN
  RAISE EXCEPTION 'signed letter fields are immutable';
 END IF;RETURN NEW;
END;$$ LANGUAGE plpgsql;
CREATE TRIGGER letter_signed_fields BEFORE UPDATE ON approval_letters FOR EACH ROW EXECUTE FUNCTION letter_signed_fields_immutable();
CREATE TABLE audit_checkpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),last_id bigint NOT NULL,last_hash text NOT NULL,event_count integer NOT NULL,
 at timestamptz NOT NULL,witness_key_id text NOT NULL,receipt jsonb NOT NULL,received_at timestamptz NOT NULL,UNIQUE(last_id,last_hash)
);
CREATE FUNCTION checkpoint_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_checkpoints is append-only';END;$$ LANGUAGE plpgsql;
CREATE TRIGGER checkpoint_no_change BEFORE UPDATE OR DELETE ON audit_checkpoints FOR EACH ROW EXECUTE FUNCTION checkpoint_append_only();
CREATE TRIGGER checkpoint_no_truncate BEFORE TRUNCATE ON audit_checkpoints FOR EACH STATEMENT EXECUTE FUNCTION checkpoint_append_only();
