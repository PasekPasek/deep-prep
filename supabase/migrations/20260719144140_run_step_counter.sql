-- Circuit breaker for the self-trigger chain.
--
-- Each pipeline step re-triggers the next over HTTP. The budget guard stops LLM
-- spend, but a state-machine bug that loops WITHOUT spending (a status ping-pong,
-- a topicIdx that stops advancing) would spin serverless invocations forever.
-- Counting steps on the run and hard-failing at a ceiling bounds the blast radius
-- of any such bug to a fixed number of invocations.

alter table runs
  add column steps int not null default 0;
