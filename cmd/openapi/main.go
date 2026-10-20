// Command openapi prints the OpenAPI document of the API, from which
// the UI's API client is generated (see scripts/gen-api.sh).
package main

import (
	"encoding/json"
	"log"
	"os"

	"just-files/internal/server"
)

func main() {
	b, err := spec()
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stdout.Write(b); err != nil {
		log.Fatal(err)
	}
}

func spec() ([]byte, error) {
	b, err := json.MarshalIndent(server.OpenAPI(), "", "  ")
	return append(b, '\n'), err
}
