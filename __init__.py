# Wszystkie dostępne lata i liczebności dla 4M_GC
number4 %>%
  filter(HRG == "4M_GC") %>%
  arrange(i) %>%
  print(n = Inf)

# Wszystkie dostępne lata i ekspozycje dla 4M_GC
hist4 %>%
  filter(HRG == "4M_GC") %>%
  arrange(i) %>%
  print(n = Inf)
