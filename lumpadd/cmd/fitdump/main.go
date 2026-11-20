// Diagnostic: prints the series fingerprint and every 60 s steady-block decision, to diff against tools/fitdump.mjs on the same file.
package main

import (
	"fmt"
	"math"
	"os"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/engine"
)

func fp(name string, a []float64) {
	s, nan := 0.0, 0
	for _, x := range a {
		if math.IsNaN(x) {
			nan++
		} else {
			s += x
		}
	}
	fmt.Printf("%s sum=%.6f nan=%d\n", name, s, nan)
}

func main() {
	S, err := engine.ReadFIT(os.Args[1])
	if err != nil {
		fmt.Println("error:", err)
		os.Exit(1)
	}
	cls, grade := engine.Classify(S), engine.GradeSeries(S)
	fmt.Println("n", S.N)
	fp("speed", S.Speed)
	fp("dist", S.Dist)
	fp("hr", S.HR)
	fp("cad", S.Cad)
	fp("alt", S.Alt)
	fp("grade", grade)
	c := [3]int{}
	for _, k := range cls {
		c[k]++
	}
	fmt.Println("classes", c)
	for _, b := range engine.SteadyBlocks(S, cls, grade) {
		fmt.Printf("block at=%d pace=%.6f hr=%.6f\n", b.At, b.Pace, b.HR)
	}
}
