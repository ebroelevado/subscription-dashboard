--
-- PostgreSQL database dump
--

\restrict 5QeDoHxcCuHAgFHqe9fq4HOYeWoFLlcrro0tFXfVPOXV8ocvYEljWXKAW9da7ZD

-- Dumped from database version 18.3 (Debian 18.3-1.pgdg13+1)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: fruta
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO fruta;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: fruta
--

COMMENT ON SCHEMA public IS '';


--
-- Name: ClientSubscriptionStatus; Type: TYPE; Schema: public; Owner: fruta
--

CREATE TYPE public."ClientSubscriptionStatus" AS ENUM (
    'active',
    'paused'
);


ALTER TYPE public."ClientSubscriptionStatus" OWNER TO fruta;

--
-- Name: SubscriptionStatus; Type: TYPE; Schema: public; Owner: fruta
--

CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'active',
    'paused'
);


ALTER TYPE public."SubscriptionStatus" OWNER TO fruta;

--
-- Name: UserPlan; Type: TYPE; Schema: public; Owner: fruta
--

CREATE TYPE public."UserPlan" AS ENUM (
    'FREE',
    'PREMIUM'
);


ALTER TYPE public."UserPlan" OWNER TO fruta;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO fruta;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.accounts (
    id text NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    provider_account_id text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text
);


ALTER TABLE public.accounts OWNER TO fruta;

--
-- Name: client_subscriptions; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.client_subscriptions (
    id text NOT NULL,
    client_id text NOT NULL,
    subscription_id text NOT NULL,
    custom_price numeric(10,2) NOT NULL,
    active_until date NOT NULL,
    joined_at date NOT NULL,
    left_at date,
    status public."ClientSubscriptionStatus" DEFAULT 'active'::public."ClientSubscriptionStatus" NOT NULL,
    remaining_days integer,
    service_password character varying(100),
    service_user character varying(100)
);


ALTER TABLE public.client_subscriptions OWNER TO fruta;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.clients (
    id text NOT NULL,
    name character varying(150) NOT NULL,
    phone character varying(30),
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id text NOT NULL,
    daily_penalty numeric(10,4),
    days_overdue integer DEFAULT 0 NOT NULL,
    discipline_score numeric(4,2),
    health_status character varying(50)
);


ALTER TABLE public.clients OWNER TO fruta;

--
-- Name: mutation_audit_logs; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.mutation_audit_logs (
    id text NOT NULL,
    user_id text NOT NULL,
    tool_name character varying(100) NOT NULL,
    target_id text,
    action character varying(20) NOT NULL,
    previous_values jsonb,
    new_values jsonb,
    undone boolean DEFAULT false NOT NULL,
    undone_at timestamp(3) without time zone,
    token character varying(64) NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    executed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.mutation_audit_logs OWNER TO fruta;

--
-- Name: plans; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.plans (
    id text NOT NULL,
    platform_id text NOT NULL,
    name character varying(100) NOT NULL,
    cost numeric(10,2) NOT NULL,
    max_seats integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id text NOT NULL
);


ALTER TABLE public.plans OWNER TO fruta;

--
-- Name: platform_renewals; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.platform_renewals (
    id text NOT NULL,
    subscription_id text NOT NULL,
    amount_paid numeric(10,2) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    paid_on date NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text
);


ALTER TABLE public.platform_renewals OWNER TO fruta;

--
-- Name: platforms; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.platforms (
    id text NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id text NOT NULL
);


ALTER TABLE public.platforms OWNER TO fruta;

--
-- Name: renewal_logs; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.renewal_logs (
    id text NOT NULL,
    client_subscription_id text,
    amount_paid numeric(10,2) NOT NULL,
    expected_amount numeric(10,2) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    paid_on date NOT NULL,
    due_on date NOT NULL,
    months_renewed integer DEFAULT 1 NOT NULL,
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.renewal_logs OWNER TO fruta;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    session_token text NOT NULL,
    user_id text NOT NULL,
    expires timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO fruta;

--
-- Name: stripe_webhook_events; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.stripe_webhook_events (
    event_id text NOT NULL,
    event_type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    error_message text
);


ALTER TABLE public.stripe_webhook_events OWNER TO fruta;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.subscriptions (
    id text NOT NULL,
    plan_id text NOT NULL,
    label character varying(100) NOT NULL,
    start_date date NOT NULL,
    active_until date NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'active'::public."SubscriptionStatus" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id text NOT NULL,
    master_password character varying(100),
    master_username character varying(100),
    owner_id text,
    is_autopayable boolean DEFAULT true NOT NULL,
    default_payment_note text DEFAULT 'como pago'::text
);


ALTER TABLE public.subscriptions OWNER TO fruta;

--
-- Name: users; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.users (
    id text NOT NULL,
    name text,
    email text NOT NULL,
    email_verified timestamp(3) without time zone,
    password text,
    image text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    "copilotToken" text,
    currency character varying(10) DEFAULT 'EUR'::character varying NOT NULL,
    discipline_penalty double precision DEFAULT 0.5 NOT NULL,
    usage_credits double precision DEFAULT 0.0 NOT NULL,
    company_name character varying(100),
    whatsapp_signature_mode character varying(20) DEFAULT 'name'::character varying NOT NULL,
    plan public."UserPlan" DEFAULT 'FREE'::public."UserPlan" NOT NULL,
    stripe_current_period_end timestamp(3) without time zone,
    stripe_customer_id text,
    stripe_price_id text,
    stripe_subscription_id text,
    stripe_cancel_at_period_end boolean DEFAULT false NOT NULL
);


ALTER TABLE public.users OWNER TO fruta;

--
-- Name: verification_tokens; Type: TABLE; Schema: public; Owner: fruta
--

CREATE TABLE public.verification_tokens (
    identifier text NOT NULL,
    token text NOT NULL,
    expires timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.verification_tokens OWNER TO fruta;

--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: client_subscriptions client_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.client_subscriptions
    ADD CONSTRAINT client_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: mutation_audit_logs mutation_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.mutation_audit_logs
    ADD CONSTRAINT mutation_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: platform_renewals platform_renewals_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.platform_renewals
    ADD CONSTRAINT platform_renewals_pkey PRIMARY KEY (id);


--
-- Name: platforms platforms_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.platforms
    ADD CONSTRAINT platforms_pkey PRIMARY KEY (id);


--
-- Name: renewal_logs renewal_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.renewal_logs
    ADD CONSTRAINT renewal_logs_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: stripe_webhook_events stripe_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.stripe_webhook_events
    ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (event_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: accounts_provider_provider_account_id_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX accounts_provider_provider_account_id_key ON public.accounts USING btree (provider, provider_account_id);


--
-- Name: client_subscriptions_client_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX client_subscriptions_client_id_idx ON public.client_subscriptions USING btree (client_id);


--
-- Name: client_subscriptions_client_id_subscription_id_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX client_subscriptions_client_id_subscription_id_key ON public.client_subscriptions USING btree (client_id, subscription_id);


--
-- Name: client_subscriptions_status_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX client_subscriptions_status_idx ON public.client_subscriptions USING btree (status);


--
-- Name: client_subscriptions_subscription_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX client_subscriptions_subscription_id_idx ON public.client_subscriptions USING btree (subscription_id);


--
-- Name: clients_user_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX clients_user_id_idx ON public.clients USING btree (user_id);


--
-- Name: mutation_audit_logs_token_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX mutation_audit_logs_token_idx ON public.mutation_audit_logs USING btree (token);


--
-- Name: mutation_audit_logs_token_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX mutation_audit_logs_token_key ON public.mutation_audit_logs USING btree (token);


--
-- Name: mutation_audit_logs_user_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX mutation_audit_logs_user_id_idx ON public.mutation_audit_logs USING btree (user_id);


--
-- Name: plans_user_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX plans_user_id_idx ON public.plans USING btree (user_id);


--
-- Name: platform_renewals_paid_on_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX platform_renewals_paid_on_idx ON public.platform_renewals USING btree (paid_on);


--
-- Name: platform_renewals_subscription_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX platform_renewals_subscription_id_idx ON public.platform_renewals USING btree (subscription_id);


--
-- Name: platforms_user_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX platforms_user_id_idx ON public.platforms USING btree (user_id);


--
-- Name: platforms_user_id_name_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX platforms_user_id_name_key ON public.platforms USING btree (user_id, name);


--
-- Name: renewal_logs_client_subscription_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX renewal_logs_client_subscription_id_idx ON public.renewal_logs USING btree (client_subscription_id);


--
-- Name: renewal_logs_paid_on_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX renewal_logs_paid_on_idx ON public.renewal_logs USING btree (paid_on);


--
-- Name: sessions_session_token_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX sessions_session_token_key ON public.sessions USING btree (session_token);


--
-- Name: subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: fruta
--

CREATE INDEX subscriptions_user_id_idx ON public.subscriptions USING btree (user_id);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: users_stripe_customer_id_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX users_stripe_customer_id_key ON public.users USING btree (stripe_customer_id);


--
-- Name: users_stripe_subscription_id_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX users_stripe_subscription_id_key ON public.users USING btree (stripe_subscription_id);


--
-- Name: verification_tokens_identifier_token_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX verification_tokens_identifier_token_key ON public.verification_tokens USING btree (identifier, token);


--
-- Name: verification_tokens_token_key; Type: INDEX; Schema: public; Owner: fruta
--

CREATE UNIQUE INDEX verification_tokens_token_key ON public.verification_tokens USING btree (token);


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_subscriptions client_subscriptions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.client_subscriptions
    ADD CONSTRAINT client_subscriptions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_subscriptions client_subscriptions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.client_subscriptions
    ADD CONSTRAINT client_subscriptions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: clients clients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mutation_audit_logs mutation_audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.mutation_audit_logs
    ADD CONSTRAINT mutation_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: plans plans_platform_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.platforms(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: plans plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: platform_renewals platform_renewals_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.platform_renewals
    ADD CONSTRAINT platform_renewals_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: platforms platforms_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.platforms
    ADD CONSTRAINT platforms_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: renewal_logs renewal_logs_client_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.renewal_logs
    ADD CONSTRAINT renewal_logs_client_subscription_id_fkey FOREIGN KEY (client_subscription_id) REFERENCES public.client_subscriptions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fruta
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: fruta
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict 5QeDoHxcCuHAgFHqe9fq4HOYeWoFLlcrro0tFXfVPOXV8ocvYEljWXKAW9da7ZD

