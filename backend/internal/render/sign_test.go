package render

import (
	"testing"
	"time"
)

func TestSigner(t *testing.T) {
	s := NewSigner([]byte("secret"))
	now := time.Unix(1_800_000_000, 0)
	exp, sig := s.Link("order-1", 10*time.Minute, now)

	if !s.Verify("order-1", exp, sig, now) {
		t.Fatal("fresh link rejected")
	}
	if s.Verify("order-2", exp, sig, now) {
		t.Error("link for one order opens another")
	}
	if s.Verify("order-1", exp, sig, now.Add(11*time.Minute)) {
		t.Error("expired link accepted")
	}
	tampered := sig[:len(sig)-1] + "0"
	if sig[len(sig)-1] == '0' {
		tampered = sig[:len(sig)-1] + "1"
	}
	if s.Verify("order-1", exp, tampered, now) {
		t.Error("tampered signature accepted")
	}
	if NewSigner([]byte("other")).Verify("order-1", exp, sig, now) {
		t.Error("link signed with another secret accepted")
	}
	if s.Verify("order-1", "not-a-number", sig, now) {
		t.Error("bad expiry accepted")
	}
}

func TestSheetSize(t *testing.T) {
	f := Sheet{WidthMM: 200, HeightMM: 200, BleedMM: 3, WrapMM: 0}
	if w, h := f.Cover(); w != 206 || h != 206 {
		t.Errorf("cover without wrap = %vx%v, want 206x206", w, h)
	}
	f.WrapMM = 15
	if w, h := f.Cover(); w != 236 || h != 236 {
		t.Errorf("cover with 15 mm wrap = %vx%v, want 236x236", w, h)
	}
	if w, h := f.Page(); w != 206 || h != 206 {
		t.Errorf("block page = %vx%v, want 206x206 (wrap applies to the cover only)", w, h)
	}
}
