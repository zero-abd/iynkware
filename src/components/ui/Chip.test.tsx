import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("stays on one line unless told to wrap, and never carries both rules", () => {
    render(
      <>
        <Chip>D13</Chip>
        <Chip wrap>A long note that has to wrap on a phone</Chip>
      </>,
    );
    const short = screen.getByText("D13").className;
    const long = screen.getByText(/long note/).className;
    expect(short).toContain("whitespace-nowrap");
    expect(short).not.toContain("whitespace-normal");
    // cx joins classes without resolving conflicts, so a wrapping chip must not keep nowrap.
    expect(long).toContain("whitespace-normal");
    expect(long).not.toContain("whitespace-nowrap");
  });
});
