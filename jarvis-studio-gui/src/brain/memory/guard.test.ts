import { describe, expect, it } from "vitest";
import { looksSecret } from "./guard";

describe("looksSecret", () => {
  it("blocks keys, passwords, OTPs, cards, Aadhaar and PAN", () => {
    expect(looksSecret("my groq key is gsk_abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    expect(looksSecret("wifi password is hunter22")).toBe(true);
    expect(looksSecret("mera otp 482913 hai")).toBe(true);
    expect(looksSecret("card 4111 1111 1111 1111")).toBe(true);
    expect(looksSecret("Aadhaar 1234 5678 9012")).toBe(true);
    expect(looksSecret("PAN ABCDE1234F")).toBe(true);
  });
  it("allows normal facts, including phone numbers and the word itself", () => {
    expect(looksSecret("mujhe chai pasand hai")).toBe(false);
    expect(looksSecret("मेरा फ़ोन नंबर 9876543210 है")).toBe(false);
    expect(looksSecret("I always forget passwords")).toBe(false);
    expect(looksSecret("meri meeting roz 5 baje hoti hai")).toBe(false);
  });
});
