-- Separate database for integration / e2e tests so they never touch dev data.
CREATE DATABASE alumni_test OWNER alumni;
