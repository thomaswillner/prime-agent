#!/usr/bin/env bash
# Fail a release step with a named, actionable error when a value supplied by
# repository configuration is missing.
#
# Usage: require-release-config.sh <ENV_NAME> <variable|secret> [SETTINGS_NAME]
#
# SETTINGS_NAME defaults to ENV_NAME and is the name to set in repository
# settings, which is not always what the step reads it as.
#
# The value is read from the environment rather than taken as an argument, so a
# secret never reaches a command line.
set -uo pipefail

usage() {
	echo "usage: $0 <ENV_NAME> <variable|secret> [SETTINGS_NAME]" >&2
	exit 2
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
	usage
fi

env_name=$1
kind=$2
settings_name=${3-$1}

case "$kind" in
variable) section="Variables" ;;
secret) section="Secrets" ;;
*) usage ;;
esac

if [ -n "${!env_name-}" ]; then
	exit 0
fi

echo "::error title=Missing release configuration::Repository ${kind} ${settings_name} is not set, so the step read \$${env_name} as empty. Add it under Settings > Secrets and variables > Actions > ${section}." >&2
exit 1
