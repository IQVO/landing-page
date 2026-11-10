.DEFAULT_GOAL := help
IMAGE ?= iqvo-landing-page:dev
PORT  ?= 8080

.PHONY: help facts engineering build check check-online serve docker-build docker-test docker-run clean

help: ## list targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  %-14s %s\n", $$1, $$2}'

facts: ## recount every number and the map from the sibling repos (needs ../ checkouts)
	node scripts/collect-facts.mjs

engineering: ## recount the engineering study (needs fetched ../ checkouts + a GitHub token: GH_TOKEN or `gh auth`)
	node scripts/collect-engineering.mjs

build: ## render src/ + data/facts.json into dist/ (SITE_URL=https://... for absolute OG urls)
	node scripts/build.mjs

check: build ## build, then lint links/a11y/CSP/size/facts consistency
	node scripts/check.mjs

check-online: build ## check + HEAD every external link
	node scripts/check.mjs --online

serve: build ## preview dist/ on http://localhost:4173 (dev only, production is nginx)
	node scripts/serve.mjs 4173

docker-build: ## build the nginx image
	docker build -t $(IMAGE) --build-arg SITE_URL="$(SITE_URL)" .

docker-test: docker-build ## run the image read-only and smoke-test headers, caching, 404, health
	scripts/smoke.sh $(IMAGE)

docker-run: docker-build ## run the image on http://localhost:$(PORT)
	docker run --rm -p $(PORT):8080 --read-only --tmpfs /tmp --tmpfs /var/cache/nginx --tmpfs /var/run $(IMAGE)

clean: ## remove dist/
	rm -rf dist

# --- agent harness (harness-template v4) -----------------------------------
.PHONY: check-fast check-all guide-lint harness-test
check-fast: check ## the agent Stop-hook gate (the full gate takes seconds, so it is the same)

check-all: check ## fleet-standard name for the full gate (= check)

guide-lint: ## lint agent guides: skills load, references resolve, context budget
	python3 scripts/harness/guide_lint.py

harness-test: ## unit-test the agent hooks (pre/post/stop)
	python3 scripts/harness/test_hook.py
	python3 scripts/harness/test_red_issue.py
