// cleancode_scan.go — counts the Go clean-code facts for one materialized repository tree.
//
//   go run scripts/cleancode_scan.go <dir>     → JSON report on stdout
//
// Part of the clean-code assessment (docs/adr/0007). Run by scripts/collect-cleancode.mjs
// against an extracted `git archive` of a repository's default branch; never by hand.
//
// What it counts (stdlib only, no type information — the blind spots are listed on the page):
//   * gofmt: files whose source differs from go/format.Source output (the `make fmt-check` rule)
//   * functions: length in lines of every named function; nesting depth of control flow
//   * files: line counts of non-test files
//   * comments: exported symbols (funcs, types, vars, consts) without a doc comment
//   * naming: exported names with underscores (scored); names that stutter the package
//     name are counted separately, never scored — the fleet's CloudEvents grammar
//     mandates entity-first event names (promise.PromiseMade), which the golint rule flags
//   * duplication: identical function bodies (whitespace/comments stripped), ≥ 5 lines
//   * debt markers: TODO/FIXME/HACK/XXX lines in non-test code files
//
// What it skips, stated on the page: testdata/, vendor/, generated files ("DO NOT EDIT")
// for every code check, *_test.go for every code check except gofmt, and files that do not
// parse (counted as parseError and never scored).
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type FnStat struct {
	File  string `json:"file"`
	Name  string `json:"name"`
	Lines int    `json:"lines"`
}

type NestStat struct {
	File  string `json:"file"`
	Name  string `json:"name"`
	Depth int    `json:"depth"`
	Lines int    `json:"lines"`
}

type Named struct {
	File string `json:"file"`
	N    int    `json:"n"`
}

type What struct {
	File string `json:"file"`
	What string `json:"what"`
}

type DupGroup struct {
	Len   int      `json:"len"`
	Files []string `json:"files"`
}

type Report struct {
	Files struct {
		Go         int `json:"go"`
		GoTest     int `json:"goTest"`
		Generated  int `json:"generated"`
		ParseError int `json:"parseError"`
	} `json:"files"`
	Fmt struct {
		NeededN int      `json:"neededN"`
		Needed  []string `json:"needed"`
	} `json:"fmt"`
	Funcs struct {
		Count   int      `json:"count"`
		OverN   int      `json:"overN"`
		Over    []FnStat `json:"over"`
		Longest FnStat   `json:"longest"`
	} `json:"funcs"`
	Nesting struct {
		OverN   int        `json:"overN"`
		Over    []NestStat `json:"over"`
		MaxSeen int        `json:"maxSeen"`
	} `json:"nesting"`
	FileSize struct {
		OverN   int      `json:"overN"`
		Over    []string `json:"over"`
		Longest struct {
			File  string `json:"file"`
			Lines int    `json:"lines"`
		} `json:"longest"`
	} `json:"fileSize"`
	Docs struct {
		Exported     int     `json:"exported"`
		Undocumented int     `json:"undocumented"`
		Share        int     `json:"share"`
		Worst        []Named `json:"worst"`
	} `json:"docs"`
	Naming struct {
		// scored: underscore in an exported name — never idiomatic Go
		ViolationsN int    `json:"violationsN"`
		Violations  []What `json:"violations"`
		// counted, never scored: golint's stutter rule, which the fleet's CloudEvents
		// grammar legitimately violates for domain events (entity-first event names)
		StutterN int    `json:"stutterN"`
		Stutter  []What `json:"stutter"`
	} `json:"naming"`
	Dup struct {
		ExtraN int        `json:"extraN"`
		Groups []DupGroup `json:"groups"`
	} `json:"dup"`
	Markers struct {
		Count    int      `json:"count"`
		Examples []string `json:"examples"`
	} `json:"markers"`
	Lines struct {
		Code int `json:"code"`
		Test int `json:"test"`
	} `json:"lines"`
}

const (
	funcLineMax  = 60 // the stated target: functions over this many lines are counted long
	nestingMax   = 4  // the stated target: control flow nested deeper than this is counted
	fileLineMax  = 800
	dupBodyMin   = 5 // lines of normalised body before two identical functions count as duplicates
	listMax      = 8
	markerStr    = `\b(TODO|FIXME|HACK|XXX)\b`
)

var markerRe = regexp.MustCompile(markerStr)

// maxNesting returns the deepest stack of nested control-flow statements in a function body.
// if/for/range/switch/type-switch/select each add a level; an else-if chain stays at the level
// of its opening if; a function literal is a fresh function and resets the count.
func maxNesting(body *ast.BlockStmt) int {
	worst := 0
	var walkStmt func(ast.Stmt, int)
	walkStmt = func(s ast.Stmt, d int) {
		if s == nil {
			return
		}
		inc := func() int { d++; if d > worst { worst = d }; return d }
		switch st := s.(type) {
		case *ast.IfStmt:
			inc()
			walkStmt(st.Body, d)
			if st.Else != nil {
				if _, isElseIf := st.Else.(*ast.IfStmt); isElseIf {
					walkStmt(st.Else, d-1)
				} else {
					walkStmt(st.Else, d)
				}
			}
		case *ast.ForStmt:
			walkStmt(st.Body, inc())
		case *ast.RangeStmt:
			walkStmt(st.Body, inc())
		case *ast.SwitchStmt:
			d = inc()
			for _, c := range st.Body.List {
				if cc, ok := c.(*ast.CaseClause); ok {
					for _, x := range cc.Body {
						walkStmt(x, d)
					}
				}
			}
		case *ast.TypeSwitchStmt:
			d = inc()
			for _, c := range st.Body.List {
				if cc, ok := c.(*ast.CaseClause); ok {
					for _, x := range cc.Body {
						walkStmt(x, d)
					}
				}
			}
		case *ast.SelectStmt:
			d = inc()
			for _, c := range st.Body.List {
				if cc, ok := c.(*ast.CaseClause); ok {
					for _, x := range cc.Body {
						walkStmt(x, d)
					}
				}
			}
		case *ast.BlockStmt:
			for _, x := range st.List {
				walkStmt(x, d)
			}
		default:
			ast.Inspect(s, func(k ast.Node) bool {
				switch v := k.(type) {
				case *ast.FuncLit:
					if w := maxNesting(v.Body); w > worst {
						worst = w
					}
					return false
				case *ast.IfStmt:
					walkStmt(v, d)
					return false
				case *ast.ForStmt:
					walkStmt(v, d)
					return false
				case *ast.RangeStmt:
					walkStmt(v, d)
					return false
				case *ast.SwitchStmt:
					walkStmt(v, d)
					return false
				case *ast.TypeSwitchStmt:
					walkStmt(v, d)
					return false
				case *ast.SelectStmt:
					walkStmt(v, d)
					return false
				case *ast.BlockStmt:
					for _, x := range v.List {
						walkStmt(x, d)
					}
					return false
				}
				return true
			})
		}
	}
	for _, st := range body.List {
		walkStmt(st, 0)
	}
	return worst
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: go run scripts/cleancode_scan.go <dir>")
		os.Exit(2)
	}
	root := os.Args[1]
	r := &Report{}
	r.Funcs.Over = []FnStat{}
	r.Nesting.Over = []NestStat{}
	r.Fmt.Needed = []string{}
	r.FileSize.Over = []string{}
	r.Docs.Worst = []Named{}
	r.Naming.Violations = []What{}
	r.Naming.Stutter = []What{}
	r.Dup.Groups = []DupGroup{}
	r.Markers.Examples = []string{}

	type dupInfo struct {
		files []string
		lines int
	}
	dups := map[string]*dupInfo{}
	undocByFile := map[string]int{}

	fset := token.NewFileSet()

	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == "testdata" || name == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		isTest := strings.HasSuffix(p, "_test.go")
		if isTest {
			r.Files.GoTest++
			r.Lines.Test += strings.Count(string(src), "\n")
		} else {
			r.Files.Go++
			nl := strings.Count(string(src), "\n")
			r.Lines.Code += nl
			if nl > r.FileSize.Longest.Lines {
				r.FileSize.Longest.File, r.FileSize.Longest.Lines = rel, nl
			}
			if nl > fileLineMax {
				r.FileSize.OverN++
				if len(r.FileSize.Over) < listMax-2 {
					r.FileSize.Over = append(r.FileSize.Over, rel)
				}
			}
		}
		af, err := parser.ParseFile(fset, p, src, parser.ParseComments|parser.SkipObjectResolution)
		if err != nil {
			r.Files.ParseError++
			return nil
		}
		// debt markers live in comments — a string key "XXX" is data, not debt
		if !isTest {
			for _, cg := range af.Comments {
				if n := len(markerRe.FindAllString(cg.Text(), -1)); n > 0 {
					r.Markers.Count += n
					if len(r.Markers.Examples) < 6 {
						t := strings.TrimSpace(strings.Replace(cg.List[0].Text, "//", "", 1))
						if len(t) > 90 {
							t = t[:90]
						}
						r.Markers.Examples = append(r.Markers.Examples, rel+": "+t)
					}
				}
			}
		}
		generated := false
		for _, cg := range af.Comments {
			t := cg.Text()
			if strings.Contains(t, "Code generated") && strings.Contains(t, "DO NOT EDIT") {
				generated = true
			}
		}
		if generated {
			r.Files.Generated++
		}
		// gofmt: every parseable file, generated included — `gofmt -l .` does the same.
		if out, ferr := format.Source(src); ferr == nil && string(out) != string(src) {
			r.Fmt.NeededN++
			if len(r.Fmt.Needed) < listMax+4 {
				r.Fmt.Needed = append(r.Fmt.Needed, rel)
			}
		}
		pkg := af.Name.Name
		addUndoc := func(file string) { r.Docs.Undocumented++; undocByFile[file]++ }
		checkName := func(file, name string) {
			if strings.Contains(name, "_") {
				r.Naming.ViolationsN++
				if len(r.Naming.Violations) < 6 {
					r.Naming.Violations = append(r.Naming.Violations, What{file, name + " — underscore in an exported name"})
				}
				return
			}
			if stutters(pkg, name) {
				r.Naming.StutterN++
				if len(r.Naming.Stutter) < 6 {
					r.Naming.Stutter = append(r.Naming.Stutter, What{file, pkg + "." + name})
				}
			}
		}

		for _, decl := range af.Decls {
			gd, isGen := decl.(*ast.GenDecl)
			if isGen {
				if isTest || generated {
					continue
				}
				for _, spec := range gd.Specs {
					var name string
					var doc *ast.CommentGroup
					switch s := spec.(type) {
					case *ast.TypeSpec:
						name, doc = s.Name.Name, s.Doc
					case *ast.ValueSpec:
						name, doc = s.Names[0].Name, s.Doc
					}
					if name == "" || !ast.IsExported(name) {
						continue
					}
					r.Docs.Exported++
					if gd.Doc == nil && doc == nil {
						addUndoc(rel)
					}
					checkName(rel, name)
				}
				continue
			}
			fd, isFn := decl.(*ast.FuncDecl)
			if !isFn || isTest || generated {
				continue
			}
			lines := fset.Position(fd.End()).Line - fset.Position(fd.Pos()).Line + 1
			r.Funcs.Count++
			if lines > r.Funcs.Longest.Lines {
				r.Funcs.Longest = FnStat{rel, fd.Name.Name, lines}
			}
			if lines > funcLineMax {
				r.Funcs.OverN++
				r.Funcs.Over = append(r.Funcs.Over, FnStat{rel, fd.Name.Name, lines})
			}
			if fd.Body != nil {
				depth := maxNesting(fd.Body)
				if depth > r.Nesting.MaxSeen {
					r.Nesting.MaxSeen = depth
				}
				if depth > nestingMax {
					r.Nesting.OverN++
					r.Nesting.Over = append(r.Nesting.Over, NestStat{rel, fd.Name.Name, depth, lines})
				}
				if lines >= dupBodyMin {
					body := string(src[fset.Position(fd.Body.Pos()).Offset:fset.Position(fd.Body.End()).Offset])
					norm := normalize(body)
					sum := sha256.Sum256([]byte(norm))
					hx := hex.EncodeToString(sum[:])
					if e, ok := dups[hx]; ok {
						e.files = append(e.files, rel+"#"+fd.Name.Name)
					} else {
						dups[hx] = &dupInfo{files: []string{rel + "#" + fd.Name.Name}, lines: len(strings.Split(norm, "\n"))}
					}
				}
			}
			if ast.IsExported(fd.Name.Name) {
				r.Docs.Exported++
				if fd.Doc == nil {
					addUndoc(rel)
				}
				checkName(rel, fd.Name.Name)
			}
		}
		return nil
	})

	for _, e := range dups {
		if len(e.files) > 1 && e.lines >= dupBodyMin {
			r.Dup.ExtraN += len(e.files) - 1
			if len(r.Dup.Groups) < listMax {
				files := e.files
				if len(files) > 4 {
					files = files[:4]
				}
				r.Dup.Groups = append(r.Dup.Groups, DupGroup{e.lines, files})
			}
		}
	}
	sort.Slice(r.Dup.Groups, func(i, j int) bool { return r.Dup.Groups[i].Len > r.Dup.Groups[j].Len })
	for f, n := range undocByFile {
		if n >= 3 {
			r.Docs.Worst = append(r.Docs.Worst, Named{f, n})
		}
	}
	sort.Slice(r.Docs.Worst, func(i, j int) bool { return r.Docs.Worst[i].N > r.Docs.Worst[j].N })
	if len(r.Docs.Worst) > 6 {
		r.Docs.Worst = r.Docs.Worst[:6]
	}
	sort.Slice(r.Funcs.Over, func(i, j int) bool { return r.Funcs.Over[i].Lines > r.Funcs.Over[j].Lines })
	if len(r.Funcs.Over) > listMax {
		r.Funcs.Over = r.Funcs.Over[:listMax]
	}
	sort.Slice(r.Nesting.Over, func(i, j int) bool { return r.Nesting.Over[i].Depth > r.Nesting.Over[j].Depth })
	if len(r.Nesting.Over) > listMax {
		r.Nesting.Over = r.Nesting.Over[:listMax]
	}
	if r.Docs.Exported > 0 {
		r.Docs.Share = 100 - int((100*r.Docs.Undocumented)/r.Docs.Exported)
	}
	out, err := json.MarshalIndent(r, "", " ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "marshal:", err)
		os.Exit(1)
	}
	fmt.Println(string(out))
}

// normalize strips indentation, blank lines and comments so two structurally identical
// bodies hash equal regardless of formatting.
func normalize(body string) string {
	var out []string
	for _, l := range strings.Split(body, "\n") {
		t := strings.TrimSpace(l)
		if t == "" || strings.HasPrefix(t, "//") {
			continue
		}
		out = append(out, t)
	}
	return strings.Join(out, "\n")
}

// stutters reports the golint rule: an exported name whose first word repeats the package
// name (events.EventList) forces callers to write events.EventList. Single-word names that
// equal the package (events.Event) are left alone, as golint does.
func stutters(pkg, name string) bool {
	var hump []rune
	for _, c := range name {
		if c >= 'A' && c <= 'Z' && len(hump) > 0 {
			break
		}
		hump = append(hump, c)
	}
	return len(name) > len(hump) && strings.EqualFold(string(hump), pkg)
}
