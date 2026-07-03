# Notes

Run `$check-links` before shipping, and again from the template:

```text
$check-links --all
```

Shell loops keep their variables to themselves:

```sh
for f in *.md; do echo $file; done
```
