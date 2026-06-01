package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestStaticContentSecurityPolicyUsesExternalProtocol(t *testing.T) {
	httpRequest, err := http.NewRequest(http.MethodGet, "http://renewlet.test/", nil)
	if err != nil {
		t.Fatal(err)
	}
	httpPolicy := staticContentSecurityPolicy(httpRequest)
	if !strings.Contains(httpPolicy, "img-src 'self' data: blob: http: https:") {
		t.Fatalf("expected HTTP policy to allow http images, got %q", httpPolicy)
	}
	if strings.Contains(httpPolicy, "upgrade-insecure-requests") {
		t.Fatalf("expected HTTP policy not to upgrade insecure requests, got %q", httpPolicy)
	}

	httpsRequest, err := http.NewRequest(http.MethodGet, "http://renewlet.test/", nil)
	if err != nil {
		t.Fatal(err)
	}
	httpsRequest.Header.Set("X-Forwarded-Proto", "https")
	httpsPolicy := staticContentSecurityPolicy(httpsRequest)
	if !strings.Contains(httpsPolicy, "img-src 'self' data: blob: https:") {
		t.Fatalf("expected HTTPS policy to allow only https images, got %q", httpsPolicy)
	}
	if !strings.Contains(httpsPolicy, "upgrade-insecure-requests") {
		t.Fatalf("expected HTTPS policy to upgrade insecure requests, got %q", httpsPolicy)
	}
}

func TestExternalRequestProtoReadsForwardedBeforeXForwardedProto(t *testing.T) {
	request, err := http.NewRequest(http.MethodGet, "http://renewlet.test/", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Forwarded", `for=192.0.2.60;proto=https;host=renewlet.example, for=198.51.100.17;proto=http`)
	request.Header.Set("X-Forwarded-Proto", "http")

	if got := externalRequestProto(request); got != "https" {
		t.Fatalf("externalRequestProto() = %q, want https", got)
	}
}
