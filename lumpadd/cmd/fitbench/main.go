// fitbench: decode every .fit file under a directory with muktihari/fit and report time and peak memory (gate G1). tormoder/fit was rejected: it fails on 95 of 169 COROS files ("parsing definition message").
package main

import (
	"bufio"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/muktihari/fit/decoder"
	"github.com/muktihari/fit/profile/typedef"
)

func hwmKB() int {
	b, _ := os.ReadFile("/proc/self/status")
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "VmHWM:") {
			var kb int
			fmt.Sscanf(strings.TrimSpace(strings.TrimPrefix(l, "VmHWM:")), "%d", &kb)
			return kb
		}
	}
	return 0
}
func main() {
	root := "."
	if len(os.Args) > 1 {
		root = os.Args[1]
	}
	var files []string
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".fit") {
			files = append(files, p)
		}
		return nil
	})
	var records, failed int
	reasons := map[string]int{}
	t0 := time.Now()
	for _, p := range files {
		f, err := os.Open(p)
		if err != nil {
			failed++
			continue
		}
		dec := decoder.New(bufio.NewReader(f))
		for dec.Next() {
			fit, err := dec.Decode()
			if err != nil {
				failed++
				reasons[strings.SplitN(err.Error(), ":", 2)[0]]++
				break
			}
			for _, m := range fit.Messages {
				if m.Num == typedef.MesgNumRecord {
					records++
				}
			}
		}
		f.Close()
	}
	d := time.Since(t0)
	for k, n := range reasons {
		fmt.Printf("  failed %3d × %s\n", n, k)
	}
	fmt.Printf("go (muktihari/fit): %d files (%d failed), %d records, %.0f ms, %.1f ms/file, peak RSS %d MB\n", len(files), failed, records, float64(d.Microseconds())/1000, float64(d.Microseconds())/1000/float64(len(files)), hwmKB()/1024)
}
